using System;
using System.Collections.Generic;
using System.Linq;

internal static partial class Host {
 // Tests replace both adapters. A saved-account choice only reads RAM and
 // validates its session; it never uses the import receiver or rewrites RAM.
 static Func<object[]> readSavedAccounts=ReadAccounts;
 static Func<Dictionary<string,object>,string,string> validateSavedSession=ValidateOperator;
 static bool ValidUserId(string id){long n;return Int64.TryParse(id,out n)&&n>0&&n.ToString()==id;}
 static HashSet<string> ProtectedIds(object raw){var ids=new HashSet<string>(StringComparer.Ordinal);foreach(var value in A(raw)){string id=Convert.ToString(value);Require(ValidUserId(id),"INVALID_ORDER");ids.Add(id);}return ids;}
 static Dictionary<string,object> OrderCustomer(Dictionary<string,object> order){return Obj("source","order","username",S(order,"customerUsername"),"state","waiting","workflowCategory","ลูกค้าจากออเดอร์");}
 static bool RolesOverlap(Dictionary<string,object> a,Dictionary<string,object> b){string aid=S(a,"userId"),bid=S(b,"userId");if(!String.IsNullOrEmpty(aid)&&!String.IsNullOrEmpty(bid))return aid==bid;string name=S(a,"username");return !String.IsNullOrEmpty(name)&&String.Equals(name,S(b,"username"),StringComparison.OrdinalIgnoreCase);}
 static Dictionary<string,object> SavedRole(string id,string role){
  Dictionary<string,object> account=null;string code=null;
  try{account=FindAccount(readSavedAccounts(),id);if(account==null || S(account,"UserID")!=id)code="RAM_ACCOUNT_NOT_FOUND";else code=validateSavedSession(account,id);}catch(HostError e){code=e.Code;}catch{code="RAM_VALIDATION_UNAVAILABLE";}
  var state=Obj("source","ram","userId",id,"username",S(account,"Username"),"state",String.IsNullOrEmpty(code)?"ready":"blocked");
  if(!String.IsNullOrEmpty(code))state["code"]=code;
  return state;
 }
 static void RestoreSavedCustomer(Dictionary<string,object> job){var customer=D(job["customer"]);job["customer"]=SavedRole(S(customer,"userId"),"customer");}
 static void RestoreDefaultOperator(Dictionary<string,object> job){
  var order=D(job["order"]);var existing=D(job.ContainsKey("operator")?job["operator"]:null);
  // A selector is scoped to this job and survives a host reconnect. Old jobs
  // without an operator use the configured first pool member (or legacy ID).
  string id=S(existing,"userId");if(String.IsNullOrEmpty(id))id=ReadOperatorPool(order).FirstOrDefault()??"";
  var selected=String.IsNullOrEmpty(id)?Obj("source","ram","userId","","username","","state","blocked","code","OPERATOR_NOT_MAPPED"):SavedRole(id,"operator");
  var customer=D(job.ContainsKey("customer")?job["customer"]:null);if(RolesOverlap(customer,selected)){selected["state"]="blocked";selected["code"]="ROLE_CONFLICT";}
  job["operator"]=selected;
  var protectedIds=ProtectedIds(job.ContainsKey("protectedOperatorUserIds")?job["protectedOperatorUserIds"]:null);foreach(var candidate in ReadOperatorPool(order))protectedIds.Add(candidate);if(ValidUserId(id))protectedIds.Add(id);job["protectedOperatorUserIds"]=protectedIds.ToArray();
 }
 static Dictionary<string,object> NewOrderJob(Dictionary<string,object> order,string[] protectedIds){var job=Obj("jobId",NewId(),"generation",1,"completionToken",NewId(),"order",order,"protectedOperatorUserIds",protectedIds,"state","preparing","customer",OrderCustomer(order));RestoreDefaultOperator(job);UpdateJobState(job);return job;}
 static Dictionary<string,object> SelectAccount(Dictionary<string,object> p){
  Require(p!=null,"INVALID_REQUEST");string role=S(p,"role"),source=S(p,"source"),id=S(p,"userId");Require((role=="customer"&&(source=="order"||source=="ram"))||(role=="operator"&&source=="ram"),"INVALID_ACCOUNT_SELECTION");Require(source=="ram"?ValidUserId(id):String.IsNullOrEmpty(id),"INVALID_ACCOUNT_SELECTION");
  string fingerprint=J.Serialize(Obj("jobId",S(p,"jobId"),"generation",S(p,"generation"),"role",role,"source",source,"userId",id));if(ReplayMutation("SELECT_ACCOUNT",p,fingerprint))return Snapshot();
  var job=D(ledger["current"]);Require(job!=null&&S(job,"jobId")==S(p,"jobId")&&S(job,"generation")==S(p,"generation"),"STALE_JOB");if(job.ContainsKey("importIntent"))Require(SettleIntent(job),"RAM_IMPORT_UNCERTAIN");
  var other=D(job.ContainsKey(role=="customer"?"operator":"customer")?job[role=="customer"?"operator":"customer"]:null);Require(source!="ram"||S(other,"userId")!=id,"ROLE_CONFLICT");
  Dictionary<string,object> selected=source=="order"?OrderCustomer(D(job["order"])):SavedRole(id,role);Require(S(selected,"code")!="RAM_ACCOUNT_NOT_FOUND","RAM_ACCOUNT_NOT_FOUND");Require(!RolesOverlap(selected,other),"ROLE_CONFLICT");
  job.Remove("importIntent");if(role=="customer"){job["generation"]=Convert.ToInt64(job["generation"])+1;CloseLogin();}else{var protectedIds=ProtectedIds(job.ContainsKey("protectedOperatorUserIds")?job["protectedOperatorUserIds"]:null);protectedIds.Add(id);job["protectedOperatorUserIds"]=protectedIds.ToArray();}
  job[role]=selected;job["completionToken"]=NewId();UpdateJobState(job);RememberMutation("SELECT_ACCOUNT",p,fingerprint);Bump();Save();return Snapshot();
 }
}
