using System;
using System.Collections.Generic;
using System.Linq;

internal static partial class Host {
 static Dictionary<string,object> CleanOrder(Dictionary<string,object> order){
  Require(order!=null&&S(order,"shopId")=="bewpakorn.rdcw.xyz","INVALID_ORDER");var clean=new Dictionary<string,object>();
  foreach(var k in new[]{"orderId","productId","productName","mapId","mapName","placeId","createdAt"})Require(!String.IsNullOrWhiteSpace(S(order,k))&&S(order,k).Length<=512,"INVALID_ORDER");
  Require(ValidUserId(S(order,"placeId")),"INVALID_ORDER");
  foreach(var k in new[]{"shopId","orderId","productId","productName","mapId","mapName","placeId","operatorUserId","createdAt","customerUsername","status"}){Require(S(order,k).Length<=512,"INVALID_ORDER");clean[k]=S(order,k);}
  var pool=ReadOperatorPool(order);clean["operatorUserIds"]=pool;object quantity=order.ContainsKey("quantity")?order["quantity"]:null;long q;if(quantity!=null){Require(Int64.TryParse(Convert.ToString(quantity),out q)&&q>0&&q<=1000000,"INVALID_ORDER");clean["quantity"]=q;}else clean["quantity"]=null;
  if(S(order,"revisit")=="True")clean["revisit"]=true;return clean;
 }
 static bool ReplayMutation(string type,Dictionary<string,object> p,string fingerprint){
  string command=S(p,"commandId");Require(command.Length>0&&command.Length<=128,"INVALID_REQUEST");var commands=D(ledger["commands"]);if(!commands.ContainsKey(command))return false;var saved=D(commands[command]);Require(S(saved,"type")==type&&S(saved,"fingerprint")==fingerprint,"COMMAND_ID_REUSED");return true;
 }
 static void RememberMutation(string type,Dictionary<string,object> p,string fingerprint){D(ledger["commands"])[S(p,"commandId")]=Obj("type",type,"fingerprint",fingerprint,"appliedAt",Now());}
 static Dictionary<string,object> UndoLast(Dictionary<string,object> p){
  Require(p!=null,"INVALID_REQUEST");Require(!p.ContainsKey("protectedOperatorUserIds")||p["protectedOperatorUserIds"] is object[],"INVALID_ORDER");var requestedProtected=ProtectedIds(p.ContainsKey("protectedOperatorUserIds")?p["protectedOperatorUserIds"]:null);string fingerprint=J.Serialize(Obj("expectedJobId",S(p,"expectedJobId"),"expectedGeneration",S(p,"expectedGeneration"),"expectedLastOrderId",S(p,"expectedLastOrderId"),"protectedOperatorUserIds",requestedProtected.OrderBy(id=>id,StringComparer.Ordinal).ToArray()));
  if(ReplayMutation("UNDO_LAST",p,fingerprint))return Snapshot();
  var current=D(ledger["current"]);Require(S(current,"jobId")==S(p,"expectedJobId")&&S(current,"generation")==S(p,"expectedGeneration"),"STALE_JOB");
  var list=A(ledger["handled"]).ToList();Require(list.Count>0,"NOTHING_TO_UNDO");var last=D(list[list.Count-1]);Require(!String.IsNullOrEmpty(S(p,"expectedLastOrderId"))&&S(last,"orderId")==S(p,"expectedLastOrderId"),"STALE_HISTORY");
  var stored=D(last.ContainsKey("order")?last["order"]:null);if(stored==null)stored=D(p.ContainsKey("restoreOrder")?p["restoreOrder"]:null);Require(stored!=null,"ORDER_HISTORY_UNAVAILABLE");
  var order=CleanOrder(stored);Require(S(order,"orderId")==S(last,"orderId")&&S(order,"shopId")==S(last,"shopId"),"STALE_HISTORY");order["revisit"]=true;
  var protectedIds=ProtectedIds(last.ContainsKey("protectedOperatorUserIds")?last["protectedOperatorUserIds"]:null);foreach(string id in ReadOperatorPool(order))protectedIds.Add(id);foreach(string id in requestedProtected)protectedIds.Add(id);if(current!=null)foreach(string id in ProtectedIds(current.ContainsKey("protectedOperatorUserIds")?current["protectedOperatorUserIds"]:null))protectedIds.Add(id);
  var restored=NewOrderJob(order,protectedIds.ToArray());
  // Pending receiver writes must be resolved before changing the selected job.
  if(current!=null&&current.ContainsKey("importIntent")){Require(SettleIntent(current),"RAM_IMPORT_UNCERTAIN");current.Remove("importIntent");}
  if(current!=null)CloseLogin();list.RemoveAt(list.Count-1);ledger["handled"]=list.ToArray();ledger["current"]=restored;RememberMutation("UNDO_LAST",p,fingerprint);Bump();Save();return Snapshot();
 }
}
