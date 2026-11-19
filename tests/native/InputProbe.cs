using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Offline harness for trusted input: loads a local fixture, types into it with
// the same code the host uses and checks that the page received real (trusted)
// key and mouse events with the exact values. No network, no credentials.
internal static partial class Host {
 internal static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=4096,RecursionLimit=16};
 internal static JavaScriptSerializer J { get { return Json; } }
 internal static Dictionary<string,object> D(object o){return o as Dictionary<string,object>;}
 internal static Dictionary<string,object> Obj(params object[] p){var d=new Dictionary<string,object>();for(int i=0;i<p.Length;i+=2)d[(string)p[i]]=p[i+1];return d;}
}
internal static class InputProbe {
 const string Fixture="<html><body>"
  +"<form onsubmit=\"window.submits++;return false\">"
  +"<input id=login-username placeholder='Username, email, or phone' autocomplete=username>"
  +"<input id=login-password type=password autocomplete=current-password>"
  +"<button type=submit>Sign in</button></form>"
  +"<script>window.events=[];window.clicks=0;window.submits=0;"
  +"for(const e of document.querySelectorAll('input'))for(const t of ['keydown','input','change','keyup'])"
  +"e.addEventListener(t,ev=>window.events.push({t:t,id:e.id,trusted:ev.isTrusted}));"
  +"document.querySelector('button').addEventListener('click',ev=>{window.clicks++;window.trusted=ev.isTrusted;});"
  +"</script></body></html>";
 const string Diag="JSON.stringify({user:document.querySelector('#login-username')?document.querySelector('#login-username').value:null,"
  +"password:document.querySelector('#login-password')?document.querySelector('#login-password').value.length:-1,"
  +"clicks:window.clicks||0,trusted:window.trusted===true,events:window.events||[],submits:window.submits||0,"
  +"path:location.pathname,body:(document.body?document.body.innerText:'').slice(0,200),"
  +"})";
 [STAThread] static int Main(string[] args){
  bool live=false;
  for(int i=0;i<(args==null?0:args.Length);i++)if(String.Equals(args[i],"live",StringComparison.OrdinalIgnoreCase))live=true;
  string user=live?"bewqueueprobe"+Guid.NewGuid().ToString("N").Substring(0,8):"fixture_user";
  string pass=live?"not-a-real-password-123":"FIXTURE_PASSWORD";
  string profile=Path.Combine(Path.GetTempPath(),"bq-input-probe-"+Guid.NewGuid().ToString("N"));
  int exit=1;string report="{\"code\":\"PROBE_FAILED\"}";
  try{
   Application.EnableVisualStyles();
   using(var form=new Form())using(var view=new WebView2()){
    form.Text=live?"Bewpakorn Queue - trusted input probe (fake account)":"Bewpakorn Queue - input probe";
    form.Width=1000;form.Height=760;view.Dock=DockStyle.Fill;form.Controls.Add(view);
    form.Shown+=async (s,e)=>{
     try{
      var env=await CoreWebView2Environment.CreateAsync(null,profile);
      await view.EnsureCoreWebView2Async(env);
      var core=view.CoreWebView2;
      var loaded=new TaskCompletionSource<bool>();
      core.NavigationCompleted+=(a,b)=>{if(!loaded.Task.IsCompleted)loaded.TrySetResult(true);};
      if(live)core.Navigate("https://www.roblox.com/login");else core.NavigateToString(Fixture);
      var settled=await Task.WhenAny(loaded.Task,Task.Delay(live?30000:15000));
      if(settled!=loaded.Task)throw new Exception("page load timeout");
      await Task.Delay(live?2500:300);
      bool focusedUser=await Host.FocusField(core,false,Host.J.Serialize(user),Host.J.Serialize(pass));
      bool typedUser=await Host.TypeTrusted(core,user);
      await Task.Delay(250);
      bool focusedPass=await Host.FocusField(core,true,Host.J.Serialize(user),Host.J.Serialize(pass));
      bool typedPass=await Host.TypeTrusted(core,pass);
      bool clicked=await Host.ClickTrusted(core);
      await Task.Delay(live?6000:400);
      string state=await core.ExecuteScriptAsync(Diag);
      var d=Host.J.DeserializeObject(Host.J.Deserialize<string>(state)) as Dictionary<string,object>;
      int trustedKeys=0,untrusted=0;
      var events=d.ContainsKey("events")?d["events"] as IEnumerable:null;
      if(events!=null)foreach(Dictionary<string,object> ev in events){if(Convert.ToBoolean(ev["trusted"]))trustedKeys++;else untrusted++;}
      string challenge=await core.ExecuteScriptAsync(LoginFormScripts.ChallengeVisible);string issue=await core.ExecuteScriptAsync(LoginFormScripts.Issue);if(issue.Length>2)issue=Host.J.Deserialize<string>(issue);else issue="";
      if(live){
       bool ok=Convert.ToString(d["user"])==user && Convert.ToInt32(d["password"])==pass.Length && clicked && challenge!="true" && issue=="CUSTOMER_PASSWORD_INVALID";
       report=Host.J.Serialize(Host.Obj("code",ok?"LIVE_INPUT_OK":"LIVE_INPUT_MISMATCH","userTyped",Convert.ToString(d["user"])==user,"passwordTyped",Convert.ToInt32(d["password"])==pass.Length,"clicks",d["clicks"],"trustedClick",d["trusted"],"trustedKeyEvents",trustedKeys,"untrustedEvents",untrusted,"focusUser",focusedUser,"focusPassword",focusedPass,"click",clicked,"challenge",challenge=="true","issue",issue,"body",d["body"]));
       exit=ok?0:2;
      }else{
       bool ok=Convert.ToString(d["user"])==user && Convert.ToInt32(d["password"])==pass.Length && Convert.ToInt32(d["clicks"])==1 && Convert.ToBoolean(d["trusted"]) && Convert.ToInt32(d["submits"])==1 && trustedKeys>0 && untrusted==0 && (focusedUser&&focusedPass&&typedUser&&typedPass&&clicked);
       report=Host.J.Serialize(Host.Obj("code",ok?"INPUT_OK":"INPUT_MISMATCH","userMatches",Convert.ToString(d["user"])==user,"passwordMatches",Convert.ToInt32(d["password"])==pass.Length,"clicks",d["clicks"],"trustedClick",d["trusted"],"trustedKeyEvents",trustedKeys,"untrustedEvents",untrusted,"focusUser",focusedUser,"focusPassword",focusedPass,"click",clicked,"submits",d["submits"]));
       exit=ok?0:2;
      }
     }catch(Exception ex){report=Host.J.Serialize(Host.Obj("code","INPUT_ERROR","error",ex.Message));exit=3;}
     finally{form.Close();}
    };
    Application.Run(form);
   }
  }finally{
   try{if(Directory.Exists(profile))Directory.Delete(profile,true);}catch{}
   Console.WriteLine(report);
  }
  return exit;
 }
}
