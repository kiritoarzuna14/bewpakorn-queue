using System;
using System.Collections.Generic;
using System.Linq;

internal static partial class Host {
 // Configured shop accounts supply the default operator and are protected
 // against an automatic order login overwriting their existing sessions.
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
 static void PoolSelfTests(){
  var old=ledger;
  try{ledger=Obj("rotation",new Dictionary<string,object>());
   Require(ReadOperatorPool(Obj("operatorUserIds",new object[]{"11","22","33"})).Length==3,"TEST");
   Require(ReadOperatorPool(Obj("operatorUserId","22"))[0]=="22","TEST");
   Require(ReadOperatorPool(Obj()).Length==0,"TEST");
   try{ReadOperatorPool(Obj("operatorUserIds",new object[]{"11","11"}));throw new Exception();}catch(HostError e){Require(e.Code=="INVALID_OPERATOR_POOL","TEST");}
   try{ReadOperatorPool(Obj("operatorUserIds",new object[]{"0"}));throw new Exception();}catch(HostError e){Require(e.Code=="INVALID_OPERATOR_POOL","TEST");}
  }finally{ledger=old;}
 }
}
