using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web;

internal static partial class Host {
 static string[] ReadOperatorPool(Dictionary<string,object> order){
  object raw;var ids=new List<string>();
  if(order.TryGetValue("operatorUserIds",out raw)){
   Require(raw is object[],"INVALID_OPERATOR_POOL");
   foreach(var item in A(raw)){Require(item is string,"INVALID_OPERATOR_POOL");ids.Add((string)item);}
  }else if(!String.IsNullOrEmpty(S(order,"operatorUserId")))ids.Add(S(order,"operatorUserId"));
  Require(ids.Count<=20 && ids.Distinct(StringComparer.Ordinal).Count()==ids.Count,"INVALID_OPERATOR_POOL");
  foreach(string id in ids){long number;Require(Int64.TryParse(id,out number)&&number>0&&number.ToString()==id,"INVALID_OPERATOR_POOL");}
  return ids.ToArray();
 }
 static string NextOperator(Dictionary<string,object> order,string[] pool){
  if(pool.Length==0)return "";
  var rotation=D(ledger.ContainsKey("rotation")?ledger["rotation"]:null);
  string last=S(rotation,S(order,"shopId")+":"+S(order,"mapId"));
  int index=Array.IndexOf(pool,last);return pool[(index+1)%pool.Length];
 }
 static void RecordOperator(Dictionary<string,object> order,string selected){
  if(String.IsNullOrEmpty(selected))return;
  if(!ledger.ContainsKey("rotation"))ledger["rotation"]=new Dictionary<string,object>();
  D(ledger["rotation"])[S(order,"shopId")+":"+S(order,"mapId")]=selected;
 }
 static bool HasPrivateDestination(Dictionary<string,object> account,out string place){
  place="";if(account==null)return false;
  var fields=D(account.ContainsKey("Fields")?account["Fields"]:null);string savedPlace=S(fields,"SavedPlaceId");Uri uri;
  if(!Regex.IsMatch(savedPlace,@"^[1-9][0-9]{0,18}$")||!Uri.TryCreate(S(fields,"SavedJobId"),UriKind.Absolute,out uri)||uri.Scheme!="https"||!uri.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase)||!Regex.IsMatch(uri.AbsolutePath,@"^/games/"+Regex.Escape(savedPlace)+@"(?:/|$)"))return false;
  string code=HttpUtility.ParseQueryString(uri.Query)["privateServerLinkCode"];
  if(String.IsNullOrWhiteSpace(code)||code.Length>2048)return false;place=savedPlace;return true;
 }
 static Dictionary<string,object> LaunchSavedPair(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null&&S(job,"jobId")==S(p,"jobId")&&S(job,"generation")==S(p,"generation"),"STALE_JOB");
  Require(!job.ContainsKey("importIntent"),"RAM_IMPORT_UNCERTAIN");
  RefreshOperator(job);
  var customer=D(job["customer"]);string id=S(customer,"userId");
  if(S(customer,"state")!="ready"){
   Require(!String.IsNullOrEmpty(id),"CUSTOMER_SESSION_NOT_READY");
   var account=FindAccount(ReadAccounts(),id);
   Require(account!=null&&String.Equals(S(account,"Username"),S(customer,"username"),StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");
   Require(!A(job["protectedOperatorUserIds"]).Any(v=>Convert.ToString(v)==id),"ROLE_CONFLICT");
   string code=ValidateOperator(account,id);customer["state"]=code==null?"ready":"blocked";
   if(code==null)customer.Remove("code");else customer["code"]=code=="OPERATOR_SESSION_INVALID"?"CUSTOMER_SESSION_INVALID":code;
  }
  UpdateJobState(job);Bump();Save();return LaunchPair(p);
 }
 static void PoolSelfTests(){
  var old=ledger;
  try{ledger=Obj("rotation",new Dictionary<string,object>());var order=Obj("shopId","shop","mapId","camera","operatorUserIds",new object[]{"11","22","33"});var pool=ReadOperatorPool(order);
   foreach(string expected in new[]{"11","22","33","11"}){string chosen=NextOperator(order,pool);Require(chosen==expected,"TEST");Require(NextOperator(order,pool)==chosen,"TEST");RecordOperator(order,chosen);}
   Require(NextOperator(Obj("shopId","shop","mapId","other"),pool)=="11","TEST");
   try{ReadOperatorPool(Obj("operatorUserIds",new object[]{"11","11"}));throw new Exception();}catch(HostError e){Require(e.Code=="INVALID_OPERATOR_POOL","TEST");}
   Require(ReadOperatorPool(Obj("operatorUserId","22"))[0]=="22","TEST");
   string folder=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"bewqueue-pool-"+NewId()),oldPath=ledgerPath;System.IO.Directory.CreateDirectory(folder);
   try{ledgerPath=System.IO.Path.Combine(folder,"ledger.json");ledger=Obj("revision",0,"current",null,"handled",new object[0],"commands",new Dictionary<string,object>());
    int turn=0;foreach(string expected in new[]{"11","22","33","11"}){
     var request=Obj("shopId","bewpakorn.rdcw.xyz","orderId","rotation-"+turn,"productId","fixture","productName","Fixture","mapId","camera","mapName","Camera","placeId","100","operatorUserId","11","operatorUserIds",new object[]{"11","22","33"},"privateServerSourceUserId","22","createdAt","2026-11-16T00:00:00Z");
     var payload=Obj("order",request,"protectedOperatorUserIds",new object[]{"11","22","33"});Claim(payload);var job=D(ledger["current"]);Require(S(D(job["order"]),"operatorUserId")==expected,"TEST");
     Claim(payload);LoadLedger();job=D(ledger["current"]);Require(S(D(job["order"]),"operatorUserId")==expected,"TEST");
     if(turn==0){D(job["customer"])["canResume"]=true;ResumeUnsubmitted(Obj("jobId",job["jobId"],"generation",job["generation"]));job=D(ledger["current"]);Require(S(D(job["order"]),"operatorUserId")==expected,"TEST");}
     Complete(Obj("commandId","rotation-command-"+turn,"jobId",job["jobId"],"orderId",request["orderId"],"generation",job["generation"],"completionToken",job["completionToken"]));turn++;
    }Require(A(ledger["handled"]).Length==4,"TEST");
   }finally{ledgerPath=oldPath;string full=System.IO.Path.GetFullPath(folder),temp=System.IO.Path.GetFullPath(System.IO.Path.GetTempPath()).TrimEnd(System.IO.Path.DirectorySeparatorChar)+System.IO.Path.DirectorySeparatorChar;Require(full.StartsWith(temp,StringComparison.OrdinalIgnoreCase)&&System.IO.Path.GetFileName(full).StartsWith("bewqueue-pool-"),"TEST_PATH");System.IO.Directory.Delete(full,true);}
  }finally{ledger=old;}
 }
}
