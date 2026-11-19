using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

// Real user input through the DevTools protocol. Filling a value from script
// produces untrusted events and an instant submit, which is the pattern Roblox
// treats as automated and answers with a human check. Typed keys and a real
// mouse click keep the same form flow with normal, trusted input events.
internal static partial class Host {
 internal static async Task Call(CoreWebView2 core,string method,Dictionary<string,object> args){
  string payload=J.Serialize(args);try{await core.CallDevToolsProtocolMethodAsync(method,payload);}finally{payload=null;}
 }
 internal static async Task<bool> TypeTrusted(CoreWebView2 core,string value){
  if(String.IsNullOrEmpty(value))return false;
  var pace=new Random(17+value.Length);
  foreach(char c in value){
   await Call(core,"Input.dispatchKeyEvent",Obj("type","char","text",c.ToString()));
   await Task.Delay(pace.Next(28,72));
  }
  return true;
 }
 internal static async Task<bool> FocusField(CoreWebView2 core,bool password,string usernameJson,string passwordJson){
  string script=password?LoginFormScripts.FocusPassword(usernameJson):LoginFormScripts.FocusUser;
  string focused;try{focused=await core.ExecuteScriptAsync(script);}finally{script=null;}
  return focused=="true";
 }
 // Types one field with trusted keystrokes after focusing it. Returns false so
 // the caller can fall back to the checked scripted fill.
 internal static async Task<bool> TypeField(CoreWebView2 core,bool password,string usernameJson,string passwordJson,string value){
  try{
   if(!await FocusField(core,password,usernameJson,passwordJson))return false;
   await Task.Delay(60);
   return await TypeTrusted(core,value);
  }catch{return false;}
 }
 // Clicks the sign-in control where it is drawn, not through element.click().
 internal static async Task<bool> ClickTrusted(CoreWebView2 core){
  try{
   string point=J.Deserialize<string>(await core.ExecuteScriptAsync(LoginFormScripts.ButtonPoint));
   if(String.IsNullOrEmpty(point))return false;
   var p=D(J.DeserializeObject(point));if(p==null)return false;
   double x=Convert.ToDouble(p["x"]),y=Convert.ToDouble(p["y"]);
   await Call(core,"Input.dispatchMouseEvent",Obj("type","mouseMoved","x",x,"y",y,"button","none","clickCount",0));
   await Task.Delay(45);
   await Call(core,"Input.dispatchMouseEvent",Obj("type","mousePressed","x",x,"y",y,"button","left","clickCount",1));
   await Task.Delay(70);
   await Call(core,"Input.dispatchMouseEvent",Obj("type","mouseReleased","x",x,"y",y,"button","left","clickCount",1));
   return true;
  }catch{return false;}
 }
}
