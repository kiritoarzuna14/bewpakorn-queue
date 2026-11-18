using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static partial class Host {
 static Form loginForm;
 static string profilesRoot;
 static void DeleteOwnedProfile(string profile){
  if(String.IsNullOrEmpty(profilesRoot))return;var root=Path.GetFullPath(profilesRoot).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;var target=Path.GetFullPath(profile);
  Require(target.StartsWith(root,StringComparison.OrdinalIgnoreCase) && String.Equals(Path.GetDirectoryName(target),root.TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase) && System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(target),@"^[0-9a-f]{32}$"),"PROFILE_PATH_INVALID");
  if(Directory.Exists(target) && (File.GetAttributes(target)&FileAttributes.ReparsePoint)==0)Directory.Delete(target,true);
 }
 // Login problems that never produced a customer session, so the user may ask
 // for the same order to be prepared again after fixing the password or
 // finishing a manual verification.
 static readonly string[] RetryableLoginCodes={"LOGIN_FORM_TIMEOUT","LOGIN_FORM_CHANGED","LOGIN_SUBMIT_TIMEOUT","CUSTOMER_LOGIN_TIMEOUT","CUSTOMER_LOGIN_CLOSED","CUSTOMER_PASSWORD_INVALID","CUSTOMER_OTP_REQUIRED","CUSTOMER_PHONE_VERIFICATION","CUSTOMER_CAPTCHA_REQUIRED","CUSTOMER_IDENTITY_VERIFICATION","CUSTOMER_LOGIN_RATE_LIMITED","CUSTOMER_VERIFICATION_UNAVAILABLE","WEBVIEW_UNAVAILABLE"};
 static bool RetryableLogin(string code){return Array.IndexOf(RetryableLoginCodes,code)>=0;}
 static void NoteLoginView(string jobId,string gen,string code,string text){
  if(String.IsNullOrEmpty(text))return;if(text.Length>300)text=text.Substring(0,300);
  lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);var role=D(job["customer"]);if(S(role,"state")!="blocked" || S(role,"code")!=code)return;role["loginView"]=text;Bump();Save();}
 }
 static Func<string,Dictionary<string,object>> authenticate=Authenticated;
 static Func<string,Dictionary<string,object>> importSession=ImportSession;
 static Func<string,Dictionary<string,object>> persistedAccount=id=>FindAccount(ReadAccounts(),id);
 static Func<Dictionary<string,object>> receiverIdentity=ReadReceiverIdentity;
 static Func<Dictionary<string,object>,bool> receiverExited=ReceiverExited;
 static bool WebViewAvailable(){try{return !String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());}catch{return false;}}
 static void CleanProfiles(){if(String.IsNullOrEmpty(profilesRoot))return;Directory.CreateDirectory(profilesRoot);foreach(var d in Directory.GetDirectories(profilesRoot)){try{DeleteOwnedProfile(d);}catch{}}}
 static Dictionary<string,object> Prepare(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation"),"STALE_JOB");
  var role=D(job["customer"]);Require(String.IsNullOrEmpty(S(role,"source")) || S(role,"source")=="order","CUSTOMER_SOURCE_CHANGED");string username=S(p,"username"),password=S(p,"password");p.Remove("password");Require(username.Length>0 && username.Length<=128 && password.Length>0 && password.Length<=1024,"INVALID_REQUEST");Require(String.IsNullOrEmpty(S(role,"username")) || String.Equals(S(role,"username"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");Require(S(role,"state")=="waiting","CUSTOMER_ALREADY_PREPARED");Require(WebViewAvailable(),"WEBVIEW_UNAVAILABLE");
  var order=D(job["order"]);Require(String.IsNullOrEmpty(S(order,"customerUsername")) || String.Equals(S(order,"customerUsername"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");order["customerUsername"]=username;
  role["source"]="order";role["username"]=username;role["state"]="preparing";role["canResume"]=false;UpdateJobState(job);Bump();Save();
  string jobId=S(job,"jobId"),gen=S(job,"generation");var secret=new LoginSecret(password);password=null;var thread=new Thread(()=>RunLogin(jobId,gen,username,secret));thread.SetApartmentState(ApartmentState.STA);thread.IsBackground=true;thread.Start();return Snapshot();
 }
 // Roles describe verified browser/RAM sessions only; games are opened by hand.
 static void UpdateJobState(Dictionary<string,object> job){var customer=D(job["customer"]);var op=D(job.ContainsKey("operator")?job["operator"]:null);var blocked=S(customer,"state")=="blocked"?customer:S(op,"state")=="blocked"?op:null;if(blocked!=null){job["state"]="blocked";job["code"]=S(blocked,"code");}else if(S(customer,"state")=="ready" && (op==null || S(op,"state")=="ready")){job["state"]="ready";job.Remove("code");}else{job["state"]="preparing";job.Remove("code");}}
 static bool Current(string jobId,string gen){var j=D(ledger["current"]);if(j==null || S(j,"jobId")!=jobId || S(j,"generation")!=gen)return false;var c=D(j["customer"]);return (String.IsNullOrEmpty(S(c,"source")) || S(c,"source")=="order") && S(c,"state")!="ready";}
 static void CloseLogin(){var f=loginForm;if(f!=null && !f.IsDisposed && f.IsHandleCreated)try{f.BeginInvoke(new Action(()=>f.Close()));}catch{}}
 static void Block(string jobId,string gen,string code){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);if(job.ContainsKey("importIntent"))code="RAM_IMPORT_UNCERTAIN";var role=D(job["customer"]);if(S(role,"state")=="blocked" && S(role,"code")==code && S(role,"waitingForUser")!="True")return;role["waitingForUser"]=false;role["state"]="blocked";role["code"]=code;if(RetryableLogin(code) && !job.ContainsKey("importIntent"))role["canResume"]=true;else role["canResume"]=false;UpdateJobState(job);Bump();Save();}}
 static bool MarkSubmission(string jobId,string gen,bool attempted){lock(Gate){if(!Current(jobId,gen))return false;var role=D(D(ledger["current"])["customer"]);role["submissionAttempted"]=attempted;role["canResume"]=false;Bump();Save();return true;}}
 sealed class LoginSecret {internal string Value;internal LoginSecret(string value){Value=value;}internal void Clear(){Value=null;}}
 static void WaitForManual(string jobId,string gen,string code){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);if(job.ContainsKey("importIntent"))return;var role=D(job["customer"]);if(S(role,"waitingForUser")=="True"&&S(role,"code")==code)return;role["state"]="blocked";role["code"]=code;role["waitingForUser"]=true;role["canResume"]=false;UpdateJobState(job);Bump();Save();}}
 static void ClearManualWait(string jobId,string gen){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);var role=D(job["customer"]);if(S(role,"waitingForUser")!="True"||job.ContainsKey("importIntent"))return;role["waitingForUser"]=false;if(LoginProgress.Manual(S(role,"code"))){role.Remove("code");role.Remove("loginView");role["state"]="preparing";role["canResume"]=false;}UpdateJobState(job);Bump();Save();}}
 static bool IsLoginPage(Uri uri){return uri!=null&&uri.Scheme=="https"&&uri.IsDefaultPort&&String.IsNullOrEmpty(uri.UserInfo)&&(uri.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase)||uri.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase))&&System.Text.RegularExpressions.Regex.IsMatch(uri.AbsolutePath,@"^/(?:[a-z]{2}(?:-[a-z]{2})?/)?login/?$",System.Text.RegularExpressions.RegexOptions.IgnoreCase);}
 static void RunLogin(string jobId,string gen,string username,LoginSecret secret){
  string profile=Path.Combine(profilesRoot,NewId());Form owned=null;try{
   using(var f=new Form())using(var browser=new WebView2()){
    owned=f;lock(Gate){if(!Current(jobId,gen))return;loginForm=f;}
    f.FormClosed+=(sender,args)=>{secret.Clear();Block(jobId,gen,"CUSTOMER_LOGIN_CLOSED");};f.Text="Bewpakorn Queue - Roblox";f.Width=1000;f.Height=750;browser.Dock=DockStyle.Fill;f.Controls.Add(browser);
    f.Shown+=async (sender,args)=>{try{
     lock(Gate){if(!Current(jobId,gen)){f.Close();return;}}var env=await CoreWebView2Environment.CreateAsync(null,profile);await browser.EnsureCoreWebView2Async(env);var core=browser.CoreWebView2;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
     core.NewWindowRequested+=(s,e)=>{e.Handled=true;};
     core.NavigationStarting+=(s,e)=>{Uri u;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out u)||u.Scheme!="https"||!(u.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase)||u.Host.EndsWith(".roblox.com",StringComparison.OrdinalIgnoreCase)))e.Cancel=true;};
     var progress=new LoginProgress(DateTime.UtcNow);bool checking=false,expired=false,dispatchPending=false;string lastCookie=null;
     Func<Task> check=async ()=>{if(checking)return;checking=true;try{
      lock(Gate){if(!Current(jobId,gen)){f.Close();return;}}
      if(DateTime.UtcNow>=progress.FormDeadline)secret.Clear();
      // A manually completed verification may issue the cookie at any point.
      // Verify/import before considering UI messages; never re-submit a login.
      var cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");var auth=cookies.FirstOrDefault(c=>c.Name==".ROBLOSECURITY"&&!String.IsNullOrEmpty(c.Value));
      if(auth!=null){if(auth.Value!=lastCookie){string cookie=auth.Value;lastCookie=cookie;secret.Clear();await Task.Run(()=>FinishLogin(jobId,gen,username,cookie));cookie=null;lock(Gate){if(!Current(jobId,gen))f.Close();}}return;}
      string issue=J.Deserialize<string>(await core.ExecuteScriptAsync(LoginFormScripts.Issue));
      bool dialog=J.Deserialize<bool>(await core.ExecuteScriptAsync(LoginFormScripts.ChallengeVisible));
      string manual=progress.Observe(issue,dialog,DateTime.UtcNow);
      if(manual!=""){WaitForManual(jobId,gen,manual);if(progress.Timeout(DateTime.UtcNow)!=""){expired=true;secret.Clear();}return;}
      ClearManualWait(jobId,gen);
      if(!String.IsNullOrEmpty(issue)){secret.Clear();expired=true;Block(jobId,gen,issue);return;}
      string timeout=progress.Timeout(DateTime.UtcNow);if(timeout!=""){expired=true;secret.Clear();Block(jobId,gen,timeout);return;}
      // DOM readiness, not full resource loading, controls preparation. The
      // shared scripts check visible controls and the exact values atomically.
      Uri source;if(expired||secret.Value==null||!progress.CanAutomate(DateTime.UtcNow)||!Uri.TryCreate(core.Source,UriKind.Absolute,out source)||!IsLoginPage(source))return;
      // The dialog layout fills left then right: the password field stays
      // disabled until the username is committed, so one field per tick.
      string script=LoginFormScripts.Stage(J.Serialize(username),J.Serialize(secret.Value));string stage;try{stage=J.Deserialize<string>(await core.ExecuteScriptAsync(script));}finally{script=null;}
      if(stage=="CHALLENGE"){progress.Observe("",true,DateTime.UtcNow);WaitForManual(jobId,gen,"CUSTOMER_IDENTITY_VERIFICATION");return;}
      if(stage=="MISMATCH"){expired=true;secret.Clear();Block(jobId,gen,"LOGIN_FORM_CHANGED");return;}
      if(stage=="USER"||stage=="PASSWORD"){
       lock(Gate){if(!Current(jobId,gen))return;}
       if(progress.Fills>=3){expired=true;secret.Clear();Block(jobId,gen,"LOGIN_FORM_CHANGED");return;}
       script=stage=="USER"?LoginFormScripts.FillUser(J.Serialize(username)):LoginFormScripts.FillPassword(J.Serialize(username),J.Serialize(secret.Value));
       try{if(await core.ExecuteScriptAsync(script)=="true")progress.RecordFill();}finally{script=null;}return;
      }
      if(stage!="READY")return;
      lock(Gate){if(!Current(jobId,gen))return;}
      if(!progress.BeginSubmission(DateTime.UtcNow)||!MarkSubmission(jobId,gen,true))return;
      string result=null;script=LoginFormScripts.SubmitChecked(J.Serialize(username),J.Serialize(secret.Value));
      dispatchPending=true;try{result=J.Deserialize<string>(await core.ExecuteScriptAsync(script));dispatchPending=false;}finally{script=null;if(result==null)secret.Clear();}
      if(progress.ProveNoClick(result)){MarkSubmission(jobId,gen,false);if(result=="CHALLENGE"){progress.Observe("",true,DateTime.UtcNow);WaitForManual(jobId,gen,"CUSTOMER_IDENTITY_VERIFICATION");}}
      else if(result=="CLICKED")secret.Clear();
      else{expired=true;secret.Clear();Block(jobId,gen,"LOGIN_FORM_CHANGED");}
     }catch{if(dispatchPending){dispatchPending=false;secret.Clear();expired=true;Block(jobId,gen,"LOGIN_FORM_CHANGED");}else{string timeout=progress.Timeout(DateTime.UtcNow);if(timeout!=""){secret.Clear();expired=true;if(LoginProgress.Manual(timeout)&&progress.WaitingForUser)WaitForManual(jobId,gen,timeout);else Block(jobId,gen,timeout);}}}finally{checking=false;}};
     core.DOMContentLoaded+=async(s,e)=>await check();core.NavigationCompleted+=async(s,e)=>await check();var timer=new System.Windows.Forms.Timer();timer.Interval=1000;timer.Tick+=async(s,e)=>await check();f.FormClosed+=(s,e)=>timer.Dispose();timer.Start();core.Navigate("https://www.roblox.com/login");
    }catch{secret.Clear();Block(jobId,gen,"WEBVIEW_UNAVAILABLE");f.Close();}};
    Application.Run(f);
   }
  }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");}finally{secret.Clear();lock(Gate){if(Object.ReferenceEquals(loginForm,owned))loginForm=null;}try{DeleteOwnedProfile(profile);}catch{}}
 }
 static Dictionary<string,object> Authenticated(string cookie){var req=(HttpWebRequest)WebRequest.Create("https://users.roblox.com/v1/users/authenticated");req.AllowAutoRedirect=false;req.Timeout=8000;req.ReadWriteTimeout=8000;req.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie;using(var r=req.GetResponse())using(var sr=new StreamReader(r.GetResponseStream()))return D(J.DeserializeObject(sr.ReadToEnd()));}
 static bool TransientIdentityFailure(WebException e){var response=e.Response as HttpWebResponse;if(response!=null){int status=(int)response.StatusCode;return status==408||status==429||status>=500;}return e.Status==WebExceptionStatus.Timeout||e.Status==WebExceptionStatus.ConnectFailure||e.Status==WebExceptionStatus.ConnectionClosed||e.Status==WebExceptionStatus.NameResolutionFailure||e.Status==WebExceptionStatus.ReceiveFailure||e.Status==WebExceptionStatus.SendFailure;}
 static Dictionary<string,object> AuthenticateLoginSession(string jobId,string gen,string cookie){
  for(int attempt=0;attempt<3;attempt++){lock(Gate){if(!Current(jobId,gen))return null;}try{return authenticate(cookie);}catch(WebException e){if(attempt==2||!TransientIdentityFailure(e))throw;}catch(TimeoutException){if(attempt==2)throw;}Thread.Sleep(500*(attempt+1));}
  throw new HostError("CUSTOMER_VERIFICATION_UNAVAILABLE");
 }
 static Dictionary<string,object> ImportSession(string cookie){
  var body=Encoding.UTF8.GetBytes(J.Serialize(Obj("cookie",cookie,"prepareNextAccount",true)));Require(body.Length<=16384,"RAM_IMPORT_FAILED");try{var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:49387/import");req.Proxy=null;req.Method="POST";req.AllowAutoRedirect=false;req.Timeout=15000;req.ReadWriteTimeout=15000;req.ContentType="application/json";req.Headers["Origin"]="chrome-extension://iljjchjkdallfnbglndggbafpnbmbpbc";req.ContentLength=body.Length;using(var deadline=new System.Threading.Timer(_=>{try{req.Abort();}catch{}},null,20000,Timeout.Infinite)){using(var stream=req.GetRequestStream())stream.Write(body,0,body.Length);using(var response=(HttpWebResponse)req.GetResponse())using(var sr=new StreamReader(response.GetResponseStream())){var chars=new char[16385];int total=0,n;while(total<chars.Length && (n=sr.Read(chars,total,chars.Length-total))>0)total+=n;Require(total<=16384,"RAM_IMPORT_FAILED");return D(J.DeserializeObject(new string(chars,0,total)));}}}finally{Array.Clear(body,0,body.Length);}
 }
 static string Fingerprint(string cookie){using(var hash=SHA256.Create()){var bytes=Encoding.UTF8.GetBytes(cookie);try{return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}finally{Array.Clear(bytes,0,bytes.Length);}}}
 static Dictionary<string,object> ReadReceiverIdentity(){
  // HttpListener uses HTTP.sys (the TCP owner may be System), so a process
  // selected merely by path is insufficient. Refuse alternate RAM instances;
  // only one known manager may exist before assigning a receiver lifetime.
  Dictionary<string,object> found=null;int candidates=0;
  foreach(var process in Process.GetProcesses()){using(process){try{
   if(!IsManagerProcessName(process.ProcessName))continue;candidates++;
   Require(candidates==1 && String.Equals(Path.GetFullPath(process.MainModule.FileName),ramExePath,StringComparison.OrdinalIgnoreCase),"RAM_RECEIVER_AMBIGUOUS");
   found=Obj("pid",process.Id,"startTimeUtcTicks",process.StartTime.ToUniversalTime().Ticks.ToString());
  }catch(HostError){throw;}catch{throw new HostError("RAM_RECEIVER_UNAVAILABLE");}}}
  Require(found!=null,"RAM_RECEIVER_UNAVAILABLE");
  try{var probe=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:49387/import");probe.Proxy=null;probe.Method="OPTIONS";probe.AllowAutoRedirect=false;probe.Timeout=3000;probe.ReadWriteTimeout=3000;probe.Headers["Origin"]="chrome-extension://iljjchjkdallfnbglndggbafpnbmbpbc";using(var response=(HttpWebResponse)probe.GetResponse())Require(response.StatusCode==HttpStatusCode.NoContent,"RAM_RECEIVER_UNAVAILABLE");}
  catch{throw new HostError("RAM_RECEIVER_UNAVAILABLE");}return found;
 }
 static bool IsManagerProcessName(string name){return name.Equals("Bewpakorn RAM",StringComparison.OrdinalIgnoreCase)||name.Equals("Roblox Account Manager",StringComparison.OrdinalIgnoreCase);}
 static bool ReceiverExited(Dictionary<string,object> intent){int pid;long ticks;if(!Int32.TryParse(S(intent,"pid"),out pid)||!Int64.TryParse(S(intent,"startTimeUtcTicks"),out ticks))return false;try{using(var p=Process.GetProcessById(pid)){return p.HasExited || p.StartTime.ToUniversalTime().Ticks!=ticks;}}catch(ArgumentException){return true;}catch{return false;}}
 static bool SettleIntent(Dictionary<string,object> job){
  var intent=D(job.ContainsKey("importIntent")?job["importIntent"]:null);if(intent==null)return false;
  try{var account=persistedAccount(S(intent,"userId"));if(account!=null && S(account,"UserID")==S(intent,"userId") && Fingerprint(S(account,"SecurityToken"))==S(intent,"cookieFingerprint"))return true;}catch{}
  try{return receiverExited(intent);}catch{return false;}
 }
 static void FinishLogin(string jobId,string gen,string username,string cookie){
  bool intentSaved=false;try{var identity=AuthenticateLoginSession(jobId,gen,cookie);if(identity==null)return;string id=S(identity,"id");long numericId;Require(Int64.TryParse(id,out numericId) && numericId>0 && String.Equals(S(identity,"name"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");
   lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);Require(!job.ContainsKey("importIntent"),"RAM_IMPORT_UNCERTAIN");Require(S(D(job.ContainsKey("operator")?job["operator"]:null),"userId")!=id && !A(job.ContainsKey("protectedOperatorUserIds")?job["protectedOperatorUserIds"]:null).Any(x=>Convert.ToString(x)==id),"ROLE_CONFLICT");
    var receiver=receiverIdentity();Require(receiver!=null && !String.IsNullOrEmpty(S(receiver,"pid")) && !String.IsNullOrEmpty(S(receiver,"startTimeUtcTicks")),"RAM_RECEIVER_UNAVAILABLE");job["importIntent"]=Obj("jobId",jobId,"userId",id,"cookieFingerprint",Fingerprint(cookie),"pid",receiver["pid"],"startTimeUtcTicks",receiver["startTimeUtcTicks"]);Bump();Save();intentSaved=true;
    var ack=importSession(cookie);Require(S(ack,"protocolVersion")=="2" && S(ack,"imported")=="True" && S(ack,"canClearBrowserSession")=="True","RAM_IMPORT_FAILED");var account=persistedAccount(id);Require(account!=null && S(account,"UserID")==id && S(account,"SecurityToken")==cookie,"RAM_PERSISTENCE_UNVERIFIED");job.Remove("importIntent");var role=D(job["customer"]);role["userId"]=id;role["state"]="ready";role["waitingForUser"]=false;role.Remove("code");UpdateJobState(job);Bump();Save();
   }
  }catch(HostError e){Block(jobId,gen,intentSaved?"RAM_IMPORT_UNCERTAIN":e.Code);}catch{Block(jobId,gen,intentSaved?"RAM_IMPORT_UNCERTAIN":"CUSTOMER_VERIFICATION_UNAVAILABLE");}
 }
}

