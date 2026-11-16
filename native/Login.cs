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
 static string profilesRoot;
 static Func<string,Dictionary<string,object>> authenticate=Authenticated;
 static Func<string,Dictionary<string,object>> importSession=ImportSession;
 static Func<string,Dictionary<string,object>> persistedAccount=id=>FindAccount(ReadAccounts(),id);
 static bool WebViewAvailable(){try{return !String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());}catch{return false;}}
 static void CleanProfiles(){if(String.IsNullOrEmpty(profilesRoot))return;Directory.CreateDirectory(profilesRoot);foreach(var d in Directory.GetDirectories(profilesRoot)){try{if(System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(d),@"^[0-9a-f]{32}$") && (File.GetAttributes(d)&FileAttributes.ReparsePoint)==0)Directory.Delete(d,true);}catch{}}}
 static Dictionary<string,object> Prepare(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation"),"STALE_JOB");
  var role=D(job["customer"]);string username=S(p,"username"),password=S(p,"password");Require(username.Length>0 && username.Length<=128 && password.Length>0 && password.Length<=1024,"INVALID_REQUEST");Require(String.IsNullOrEmpty(S(role,"username")) || S(role,"username")==username,"CUSTOMER_ID_MISMATCH");Require(S(role,"state")=="waiting","CUSTOMER_ALREADY_PREPARED");Require(WebViewAvailable(),"WEBVIEW_UNAVAILABLE");
  role["username"]=username;role["state"]="preparing";UpdateJobState(job);Bump();Save();
  string jobId=S(job,"jobId"),gen=S(job,"generation");var thread=new Thread(()=>RunLogin(jobId,gen,username,password));thread.SetApartmentState(ApartmentState.STA);thread.IsBackground=true;thread.Start();return Snapshot();
 }
 static void UpdateJobState(Dictionary<string,object> job){var customer=D(job["customer"]);var op=D(job["operator"]);if(S(op,"state")=="blocked"){job["state"]="blocked";job["code"]=S(op,"code");}else if(S(customer,"state")=="blocked"){job["state"]="blocked";job["code"]=S(customer,"code");}else if(S(op,"state")=="ready" && S(customer,"state")=="ready"){job["state"]="ready";job.Remove("code");}else{job["state"]="preparing";job.Remove("code");}}
 static bool Current(string jobId,string gen){var j=D(ledger["current"]);return j!=null && S(j,"jobId")==jobId && S(j,"generation")==gen && S(D(j["customer"]),"state")!="ready";}
 static void CloseLogin(){var f=loginForm;if(f!=null && !f.IsDisposed && f.IsHandleCreated)try{f.BeginInvoke(new Action(()=>f.Close()));}catch{}}
 static void Block(string jobId,string gen,string code){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);var role=D(job["customer"]);if(S(role,"state")=="blocked" && S(role,"code")==code)return;role["state"]="blocked";role["code"]=code;UpdateJobState(job);Bump();Save();}}
 static void RunLogin(string jobId,string gen,string username,string password){
  string profile=Path.Combine(profilesRoot,NewId());Form owned=null;try{
   using(var f=new Form())using(var browser=new WebView2()){
    owned=f;lock(Gate){if(!Current(jobId,gen))return;loginForm=f;}
    f.FormClosed+=(sender,args)=>Block(jobId,gen,"CUSTOMER_LOGIN_CLOSED");f.Text="Bewpakorn Queue - Roblox";f.Width=1000;f.Height=750;browser.Dock=DockStyle.Fill;f.Controls.Add(browser);
    f.Shown+=async (sender,args)=>{try{
     lock(Gate){if(!Current(jobId,gen)){f.Close();return;}} var env=await CoreWebView2Environment.CreateAsync(null,profile);await browser.EnsureCoreWebView2Async(env);var core=browser.CoreWebView2;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
     core.NewWindowRequested+=(s,e)=>{e.Handled=true;};
     core.NavigationStarting+=(s,e)=>{Uri u;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out u) || u.Scheme!="https" || !(u.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase)||u.Host.EndsWith(".roblox.com",StringComparison.OrdinalIgnoreCase)))e.Cancel=true;};
     bool submitted=false,busy=false,pageLoaded=false,checking=false,expired=false;string lastCookie=null;DateTime deadline=DateTime.UtcNow.AddSeconds(30);
     Func<Task> check=async ()=>{if(checking)return;checking=true;try{
      lock(Gate){if(!Current(jobId,gen)){f.Close();return;}}
      var cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");var auth=cookies.FirstOrDefault(c=>c.Name==".ROBLOSECURITY" && !String.IsNullOrEmpty(c.Value));
      if(auth!=null && !busy && auth.Value!=lastCookie){busy=true;string cookie=auth.Value;lastCookie=cookie;await Task.Run(()=>FinishLogin(jobId,gen,username,cookie));busy=false;lock(Gate){if(!Current(jobId,gen))f.Close();}return;}
      if(!pageLoaded)return;
      string issue=await core.ExecuteScriptAsync("(()=>{const t=(document.body?.innerText||'').toLowerCase();if(document.querySelector('iframe[src*=captcha], [data-testid*=captcha]')||/verify you are human|security challenge|captcha/.test(t))return 'CUSTOMER_CAPTCHA_REQUIRED';if(/verify (using|with|on) (your )?(phone|mobile)|check your (phone|mobile)|approve (the )?(login|request)/.test(t))return 'CUSTOMER_PHONE_VERIFICATION';if(document.querySelector('input[autocomplete=one-time-code]')||/verification code|two.step verification|2.step verification/.test(t))return 'CUSTOMER_OTP_REQUIRED';if(/incorrect (username or password|password)|invalid (username or password|password)/.test(t))return 'CUSTOMER_PASSWORD_INVALID';return '';})()");
      string code=J.Deserialize<string>(issue);if(!String.IsNullOrEmpty(code)){Block(jobId,gen,code);}
      Uri source;if(!submitted && !expired && String.IsNullOrEmpty(code) && Uri.TryCreate(core.Source,UriKind.Absolute,out source) && source.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase) && source.AbsolutePath.StartsWith("/login",StringComparison.OrdinalIgnoreCase)){
       if(DateTime.UtcNow>=deadline){expired=true;password=null;Block(jobId,gen,"LOGIN_FORM_TIMEOUT");}
       else{string ready=await core.ExecuteScriptAsync("!!(document.querySelector('#login-username')&&document.querySelector('#login-password')&&document.querySelector('#login-button'))");if(ready=="true"){
        lock(Gate){if(!Current(jobId,gen))return;}
        submitted=true;string script="(()=>{const u=document.querySelector('#login-username'),p=document.querySelector('#login-password'),b=document.querySelector('#login-button');if(!u||!p||!b)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(u,"+J.Serialize(username)+");u.dispatchEvent(new Event('input',{bubbles:true}));set.call(p,"+J.Serialize(password)+");p.dispatchEvent(new Event('input',{bubbles:true}));b.click();return true;})()";password=null;var result=await core.ExecuteScriptAsync(script);script=null;if(result!="true")Block(jobId,gen,"LOGIN_FORM_CHANGED");
       }}
      }
     }catch{Block(jobId,gen,"CUSTOMER_LOGIN_UNAVAILABLE");}finally{checking=false;}};
     core.NavigationCompleted+=async (s,e)=>{if(e.IsSuccess){pageLoaded=true;await check();}};var timer=new System.Windows.Forms.Timer();timer.Interval=2000;timer.Tick+=async (s,e)=>await check();f.FormClosed+=(s,e)=>timer.Dispose();timer.Start();core.Navigate("https://www.roblox.com/login");
    }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");f.Close();}};
    Application.Run(f);
   }
  }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");}finally{password=null;lock(Gate){if(Object.ReferenceEquals(loginForm,owned))loginForm=null;}try{if(Directory.Exists(profile))Directory.Delete(profile,true);}catch{}}
 }
 static Dictionary<string,object> Authenticated(string cookie){var req=(HttpWebRequest)WebRequest.Create("https://users.roblox.com/v1/users/authenticated");req.AllowAutoRedirect=false;req.Timeout=8000;req.ReadWriteTimeout=8000;req.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie;using(var r=req.GetResponse())using(var sr=new StreamReader(r.GetResponseStream()))return D(J.DeserializeObject(sr.ReadToEnd()));}
 static Dictionary<string,object> ImportSession(string cookie){
  var body=Encoding.UTF8.GetBytes(J.Serialize(Obj("cookie",cookie,"prepareNextAccount",true)));Require(body.Length<=16384,"RAM_IMPORT_FAILED");try{var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:49387/import");req.Method="POST";req.AllowAutoRedirect=false;req.Timeout=15000;req.ReadWriteTimeout=15000;req.ContentType="application/json";req.Headers["Origin"]="chrome-extension://iljjchjkdallfnbglndggbafpnbmbpbc";req.ContentLength=body.Length;using(var deadline=new System.Threading.Timer(_=>{try{req.Abort();}catch{}},null,20000,Timeout.Infinite)){using(var stream=req.GetRequestStream())stream.Write(body,0,body.Length);using(var response=(HttpWebResponse)req.GetResponse())using(var sr=new StreamReader(response.GetResponseStream())){var chars=new char[16385];int total=0,n;while(total<chars.Length && (n=sr.Read(chars,total,chars.Length-total))>0)total+=n;Require(total<=16384,"RAM_IMPORT_FAILED");return D(J.DeserializeObject(new string(chars,0,total)));}}}finally{Array.Clear(body,0,body.Length);}
 }
 static void FinishLogin(string jobId,string gen,string username,string cookie){
  try{var identity=authenticate(cookie);string id=S(identity,"id");long numericId;Require(Int64.TryParse(id,out numericId) && numericId>0 && String.Equals(S(identity,"name"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");
   lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);Require(S(D(job["operator"]),"userId")!=id,"ROLE_CONFLICT");
    var ack=importSession(cookie);Require(S(ack,"protocolVersion")=="2" && S(ack,"imported")=="True" && S(ack,"canClearBrowserSession")=="True","RAM_IMPORT_FAILED");var account=persistedAccount(id);Require(account!=null && S(account,"SecurityToken")==cookie,"RAM_PERSISTENCE_UNVERIFIED");var role=D(job["customer"]);role["userId"]=id;role["state"]="ready";role.Remove("code");UpdateJobState(job);Bump();Save();
   }
  }catch(HostError e){Block(jobId,gen,e.Code);}catch{Block(jobId,gen,"CUSTOMER_VERIFICATION_UNAVAILABLE");}
 }
}
