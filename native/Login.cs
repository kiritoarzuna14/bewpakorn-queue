using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static partial class Host {
 static Form loginForm;
 static bool WebViewAvailable(){try{return !String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());}catch{return false;}}
 static Dictionary<string,object> Prepare(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation"),"STALE_JOB");
  var role=D(job["customer"]);string username=S(p,"username"),password=S(p,"password");Require(username.Length>0 && username.Length<=128 && password.Length>0 && password.Length<=1024,"INVALID_REQUEST");Require(String.IsNullOrEmpty(S(role,"username")) || S(role,"username")==username,"CUSTOMER_ID_MISMATCH");Require(S(role,"state")=="waiting","CUSTOMER_ALREADY_PREPARED");Require(WebViewAvailable(),"WEBVIEW_UNAVAILABLE");
  role["username"]=username;role["state"]="preparing";job["state"]="preparing";job.Remove("code");Bump();Save();
  string jobId=S(job,"jobId"),gen=S(job,"generation");var thread=new Thread(()=>RunLogin(jobId,gen,username,password));thread.SetApartmentState(ApartmentState.STA);thread.IsBackground=true;thread.Start();return Snapshot();
 }
 static bool Current(string jobId,string gen){var j=D(ledger["current"]);return j!=null && S(j,"jobId")==jobId && S(j,"generation")==gen && S(D(j["customer"]),"state")=="preparing";}
 static void CloseLogin(){var f=loginForm;if(f!=null && !f.IsDisposed && f.IsHandleCreated)try{f.BeginInvoke(new Action(()=>f.Close()));}catch{}}
 static void Block(string jobId,string gen,string code){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);var role=D(job["customer"]);role["state"]="blocked";role["code"]=code;job["state"]="blocked";job["code"]=code;Bump();Save();}}
 static void RunLogin(string jobId,string gen,string username,string password){
  string profile=Path.Combine(Path.GetTempPath(),"BewpakornQueue-"+NewId());try{
   using(var f=new Form())using(var browser=new WebView2()){
    f.FormClosed+=(sender,args)=>Block(jobId,gen,"CUSTOMER_LOGIN_CLOSED"); f.Text="Bewpakorn Queue - Roblox";f.Width=1000;f.Height=750;browser.Dock=DockStyle.Fill;f.Controls.Add(browser);loginForm=f;
    f.Shown+=async (sender,args)=>{try{
     lock(Gate){if(!Current(jobId,gen)){f.Close();return;}} var env=await CoreWebView2Environment.CreateAsync(null,profile);await browser.EnsureCoreWebView2Async(env);var core=browser.CoreWebView2;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
     core.NewWindowRequested+=(s,e)=>{e.Handled=true;};
     core.NavigationStarting+=(s,e)=>{Uri u;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out u) || u.Scheme!="https" || !(u.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase)||u.Host.EndsWith(".roblox.com",StringComparison.OrdinalIgnoreCase)))e.Cancel=true;};
     bool submitted=false,busy=false,pageLoaded=false;
     Func<Task> check=async ()=>{try{
      lock(Gate){if(!Current(jobId,gen)){f.Close();return;}}
      var cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");var auth=cookies.FirstOrDefault(c=>c.Name==".ROBLOSECURITY" && !String.IsNullOrEmpty(c.Value));
      if(auth!=null && !busy){busy=true;string cookie=auth.Value; await Task.Run(()=>FinishLogin(jobId,gen,username,cookie));lock(Gate){if(!Current(jobId,gen))f.Close();}return;}
      if(pageLoaded && !submitted && new Uri(core.Source).Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase) && new Uri(core.Source).AbsolutePath.StartsWith("/login",StringComparison.OrdinalIgnoreCase)){
       submitted=true;string script="(()=>{const u=document.querySelector('#login-username'),p=document.querySelector('#login-password'),b=document.querySelector('#login-button');if(!u||!p||!b)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(u,"+J.Serialize(username)+");u.dispatchEvent(new Event('input',{bubbles:true}));set.call(p,"+J.Serialize(password)+");p.dispatchEvent(new Event('input',{bubbles:true}));b.click();return true;})()";password=null;var result=await core.ExecuteScriptAsync(script);script=null;if(result!="true")Block(jobId,gen,"LOGIN_FORM_CHANGED");
      }
     }catch{Block(jobId,gen,"CUSTOMER_LOGIN_UNAVAILABLE");}};
     core.NavigationCompleted+=async (s,e)=>{if(e.IsSuccess){pageLoaded=true;await check();}}; var timer=new System.Windows.Forms.Timer();timer.Interval=2000;timer.Tick+=async (s,e)=>await check();f.FormClosed+=(s,e)=>timer.Dispose();timer.Start();
     core.Navigate("https://www.roblox.com/login");
    }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");f.Close();}};
    Application.Run(f);
   }
  }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");}finally{password=null;loginForm=null;try{Directory.Delete(profile,true);}catch{}}
 }
 static Dictionary<string,object> Authenticated(string cookie){var req=(HttpWebRequest)WebRequest.Create("https://users.roblox.com/v1/users/authenticated");req.AllowAutoRedirect=false;req.Timeout=8000;req.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie;using(var r=req.GetResponse())using(var sr=new StreamReader(r.GetResponseStream()))return D(J.DeserializeObject(sr.ReadToEnd()));}
 static void FinishLogin(string jobId,string gen,string username,string cookie){
  try{var identity=Authenticated(cookie);string id=S(identity,"id");Require(!String.IsNullOrEmpty(id) && String.Equals(S(identity,"name"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");
   lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);Require(S(D(job["operator"]),"userId")!=id,"ROLE_CONFLICT");
    var body=Encoding.UTF8.GetBytes(J.Serialize(Obj("cookie",cookie,"prepareNextAccount",true)));Require(body.Length<=16384,"RAM_IMPORT_FAILED");var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:49387/import");req.Method="POST";req.AllowAutoRedirect=false;req.Timeout=15000;req.ReadWriteTimeout=15000;req.ContentType="application/json";req.Headers["Origin"]="chrome-extension://iljjchjkdallfnbglndggbafpnbmbpbc";req.ContentLength=body.Length;using(var stream=req.GetRequestStream())stream.Write(body,0,body.Length);Array.Clear(body,0,body.Length);
    Dictionary<string,object> ack;using(var response=(HttpWebResponse)req.GetResponse())using(var sr=new StreamReader(response.GetResponseStream()))ack=D(J.DeserializeObject(sr.ReadToEnd()));Require(S(ack,"protocolVersion")=="2" && S(ack,"imported")=="True" && S(ack,"canClearBrowserSession")=="True","RAM_IMPORT_FAILED");
    var account=FindAccount(ReadAccounts(),id);Require(account!=null && S(account,"SecurityToken")==cookie,"RAM_PERSISTENCE_UNVERIFIED");var role=D(job["customer"]);role["userId"]=id;role["state"]="ready";job["state"]=S(D(job["operator"]),"state")=="ready"?"ready":"blocked";if(S(job,"state")=="blocked")job["code"]=S(D(job["operator"]),"code");Bump();Save();
   }
  }catch(HostError e){Block(jobId,gen,e.Code);}catch{Block(jobId,gen,"CUSTOMER_VERIFICATION_UNAVAILABLE");}
 }
}
