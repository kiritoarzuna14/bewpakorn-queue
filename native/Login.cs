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
 static Func<string,Dictionary<string,object>> authenticate=Authenticated;
 static Func<string,Dictionary<string,object>> importSession=ImportSession;
 static Func<string,Dictionary<string,object>> persistedAccount=id=>FindAccount(ReadAccounts(),id);
 static Func<Dictionary<string,object>> receiverIdentity=ReadReceiverIdentity;
 static Func<Dictionary<string,object>,bool> receiverExited=ReceiverExited;
 static bool WebViewAvailable(){try{return !String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString());}catch{return false;}}
 static void CleanProfiles(){if(String.IsNullOrEmpty(profilesRoot))return;Directory.CreateDirectory(profilesRoot);foreach(var d in Directory.GetDirectories(profilesRoot)){try{DeleteOwnedProfile(d);}catch{}}}
 static Dictionary<string,object> Prepare(Dictionary<string,object> p){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(p,"jobId") && S(job,"generation")==S(p,"generation"),"STALE_JOB");
  var role=D(job["customer"]);string username=S(p,"username"),password=S(p,"password");Require(username.Length>0 && username.Length<=128 && password.Length>0 && password.Length<=1024,"INVALID_REQUEST");Require(String.IsNullOrEmpty(S(role,"username")) || S(role,"username")==username,"CUSTOMER_ID_MISMATCH");Require(S(role,"state")=="waiting","CUSTOMER_ALREADY_PREPARED");Require(WebViewAvailable(),"WEBVIEW_UNAVAILABLE");
  role["username"]=username;role["state"]="preparing";role["canResume"]=false;UpdateJobState(job);Bump();Save();
  string jobId=S(job,"jobId"),gen=S(job,"generation");var thread=new Thread(()=>RunLogin(jobId,gen,username,password));thread.SetApartmentState(ApartmentState.STA);thread.IsBackground=true;thread.Start();return Snapshot();
 }
 static void UpdateJobState(Dictionary<string,object> job){var customer=D(job["customer"]);var op=D(job["operator"]);var cg=D(customer.ContainsKey("game")?customer["game"]:null);var og=D(op.ContainsKey("game")?op["game"]:null);if(S(op,"state")=="blocked"){job["state"]="blocked";job["code"]=S(op,"code");}else if(S(customer,"state")=="blocked"){job["state"]="blocked";job["code"]=S(customer,"code");}else if(S(og,"state")=="blocked"||S(cg,"state")=="blocked"){job["state"]="blocked";job["code"]=S(og,"state")=="blocked"?S(og,"code"):S(cg,"code");}else if(S(op,"state")=="ready" && S(customer,"state")=="ready" && S(og,"state")=="connected" && S(cg,"state")=="connected"){job["state"]="ready";job.Remove("code");}else{job["state"]="preparing";job.Remove("code");}}
 static bool Current(string jobId,string gen){var j=D(ledger["current"]);return j!=null && S(j,"jobId")==jobId && S(j,"generation")==gen && S(D(j["customer"]),"state")!="ready";}
 static void CloseLogin(){var f=loginForm;if(f!=null && !f.IsDisposed && f.IsHandleCreated)try{f.BeginInvoke(new Action(()=>f.Close()));}catch{}}
 static void Block(string jobId,string gen,string code){lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);var role=D(job["customer"]);if(S(role,"state")=="blocked" && S(role,"code")==code)return;role["state"]="blocked";role["code"]=code;if(code=="LOGIN_FORM_TIMEOUT" && S(role,"submissionAttempted")!="True" && !job.ContainsKey("importIntent"))role["canResume"]=true;UpdateJobState(job);Bump();Save();}}
 static bool MarkSubmission(string jobId,string gen,bool attempted){lock(Gate){if(!Current(jobId,gen))return false;var role=D(D(ledger["current"])["customer"]);role["submissionAttempted"]=attempted;role["canResume"]=false;Bump();Save();return true;}}
 static void RunLogin(string jobId,string gen,string username,string password){
  string profile=Path.Combine(profilesRoot,NewId());Form owned=null;try{
   using(var f=new Form())using(var browser=new WebView2()){
    owned=f;lock(Gate){if(!Current(jobId,gen))return;loginForm=f;}
    f.FormClosed+=(sender,args)=>Block(jobId,gen,"CUSTOMER_LOGIN_CLOSED");f.Text="Bewpakorn Queue - Roblox";f.Width=1000;f.Height=750;browser.Dock=DockStyle.Fill;f.Controls.Add(browser);
    f.Shown+=async (sender,args)=>{try{
     lock(Gate){if(!Current(jobId,gen)){f.Close();return;}} var env=await CoreWebView2Environment.CreateAsync(null,profile);await browser.EnsureCoreWebView2Async(env);var core=browser.CoreWebView2;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
     core.NewWindowRequested+=(s,e)=>{e.Handled=true;};
     core.NavigationStarting+=(s,e)=>{Uri u;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out u) || u.Scheme!="https" || !(u.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase)||u.Host.EndsWith(".roblox.com",StringComparison.OrdinalIgnoreCase)))e.Cancel=true;};
     bool filled=false,submitted=false,busy=false,pageLoaded=false,checking=false,expired=false,loginTimedOut=false;string lastCookie=null;DateTime deadline=DateTime.UtcNow.AddSeconds(30),submitDeadline=DateTime.MaxValue,loginDeadline=DateTime.MaxValue;
     Func<Task> check=async ()=>{if(checking)return;checking=true;try{
      lock(Gate){if(!Current(jobId,gen)){f.Close();return;}}
      var cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");var auth=cookies.FirstOrDefault(c=>c.Name==".ROBLOSECURITY" && !String.IsNullOrEmpty(c.Value));
      if(auth!=null && !busy && auth.Value!=lastCookie){busy=true;string cookie=auth.Value;lastCookie=cookie;await Task.Run(()=>FinishLogin(jobId,gen,username,cookie));busy=false;lock(Gate){if(!Current(jobId,gen))f.Close();}return;}
      if(!pageLoaded){if(!expired && DateTime.UtcNow>=deadline){expired=true;password=null;Block(jobId,gen,"LOGIN_FORM_TIMEOUT");}return;}
      string issue=await core.ExecuteScriptAsync("(()=>{const t=(document.body?.innerText||'').toLowerCase();const visible=s=>Array.from(document.querySelectorAll(s)).some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);if(visible('iframe[src*=captcha],iframe[src*=arkoselabs],[data-testid*=captcha]')||/verify you are human|security challenge|ยืนยันว่าคุณเป็นมนุษย์/.test(t))return 'CUSTOMER_CAPTCHA_REQUIRED';if(/verify (using|with|on) (your )?(phone|mobile)|check your (phone|mobile)|approve (the )?(login|request)|โปรดเปิดแอป roblox|โทรศัพท์มือถือหรือแท็บเล็ตที่ลงชื่อเข้าใช้อยู่/.test(t))return 'CUSTOMER_PHONE_VERIFICATION';if(visible('input[autocomplete=one-time-code]')||/verification code|two.step verification|2.step verification|รหัสยืนยัน|การตรวจสอบยืนยันตัวตน 2 ขั้นตอน/.test(t))return 'CUSTOMER_OTP_REQUIRED';if(/incorrect (username or password|password)|invalid (username or password|password)|ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง|รหัสผ่านไม่ถูกต้อง/.test(t))return 'CUSTOMER_PASSWORD_INVALID';return '';})()");
      string code=J.Deserialize<string>(issue);if(!String.IsNullOrEmpty(code)){Block(jobId,gen,code);}
      if(submitted && !loginTimedOut && DateTime.UtcNow>=loginDeadline){loginTimedOut=true;Block(jobId,gen,"CUSTOMER_LOGIN_TIMEOUT");}
      Uri source;if(!submitted && !expired && String.IsNullOrEmpty(code) && Uri.TryCreate(core.Source,UriKind.Absolute,out source) && source.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase) && source.AbsolutePath.StartsWith("/login",StringComparison.OrdinalIgnoreCase)){
       if(!filled){
        if(DateTime.UtcNow>=deadline){expired=true;password=null;Block(jobId,gen,"LOGIN_FORM_TIMEOUT");}
        else if(await core.ExecuteScriptAsync(LoginFormScripts.Ready)=="true"){
         lock(Gate){if(!Current(jobId,gen))return;}
         filled=true;submitDeadline=DateTime.UtcNow.AddSeconds(30);string script=LoginFormScripts.Fill(J.Serialize(username),J.Serialize(password));password=null;var result=await core.ExecuteScriptAsync(script);script=null;
         if(result!="true"){expired=true;Block(jobId,gen,"LOGIN_FORM_CHANGED");}
        }
       }else if(DateTime.UtcNow>=submitDeadline){expired=true;Block(jobId,gen,"LOGIN_SUBMIT_TIMEOUT");}
       else{
        lock(Gate){if(!Current(jobId,gen))return;}
        // Mark before dispatch: an unknown script outcome must never retry a
        // click. PENDING/CHALLENGE explicitly prove no click was attempted.
        if(!MarkSubmission(jobId,gen,true))return;submitted=true;var result=await core.ExecuteScriptAsync(LoginFormScripts.Submit);
        if(result=="\"PENDING\""||result=="\"CHALLENGE\""){submitted=false;MarkSubmission(jobId,gen,false);}
        else if(result=="\"CLICKED\"")loginDeadline=DateTime.UtcNow.AddSeconds(90);
        else{expired=true;Block(jobId,gen,"LOGIN_FORM_CHANGED");}
       }
      }
     }catch{Block(jobId,gen,"CUSTOMER_LOGIN_UNAVAILABLE");}finally{checking=false;}};
     core.NavigationCompleted+=async (s,e)=>{if(e.IsSuccess){pageLoaded=true;await check();}};var timer=new System.Windows.Forms.Timer();timer.Interval=2000;timer.Tick+=async (s,e)=>await check();f.FormClosed+=(s,e)=>timer.Dispose();timer.Start();core.Navigate("https://www.roblox.com/login");
    }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");f.Close();}};
    Application.Run(f);
   }
  }catch{Block(jobId,gen,"WEBVIEW_UNAVAILABLE");}finally{password=null;lock(Gate){if(Object.ReferenceEquals(loginForm,owned))loginForm=null;}try{DeleteOwnedProfile(profile);}catch{}}
 }
 static Dictionary<string,object> Authenticated(string cookie){var req=(HttpWebRequest)WebRequest.Create("https://users.roblox.com/v1/users/authenticated");req.AllowAutoRedirect=false;req.Timeout=8000;req.ReadWriteTimeout=8000;req.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie;using(var r=req.GetResponse())using(var sr=new StreamReader(r.GetResponseStream()))return D(J.DeserializeObject(sr.ReadToEnd()));}
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
  bool intentSaved=false;try{var identity=authenticate(cookie);string id=S(identity,"id");long numericId;Require(Int64.TryParse(id,out numericId) && numericId>0 && String.Equals(S(identity,"name"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");
   lock(Gate){if(!Current(jobId,gen))return;var job=D(ledger["current"]);Require(!job.ContainsKey("importIntent"),"RAM_IMPORT_UNCERTAIN");Require(!A(job.ContainsKey("protectedOperatorUserIds")?job["protectedOperatorUserIds"]:null).Any(x=>Convert.ToString(x)==id),"ROLE_CONFLICT");
    var receiver=receiverIdentity();Require(receiver!=null && !String.IsNullOrEmpty(S(receiver,"pid")) && !String.IsNullOrEmpty(S(receiver,"startTimeUtcTicks")),"RAM_RECEIVER_UNAVAILABLE");job["importIntent"]=Obj("jobId",jobId,"userId",id,"cookieFingerprint",Fingerprint(cookie),"pid",receiver["pid"],"startTimeUtcTicks",receiver["startTimeUtcTicks"]);Bump();Save();intentSaved=true;
    var ack=importSession(cookie);Require(S(ack,"protocolVersion")=="2" && S(ack,"imported")=="True" && S(ack,"canClearBrowserSession")=="True","RAM_IMPORT_FAILED");var account=persistedAccount(id);Require(account!=null && S(account,"UserID")==id && S(account,"SecurityToken")==cookie,"RAM_PERSISTENCE_UNVERIFIED");job.Remove("importIntent");var role=D(job["customer"]);role["userId"]=id;role["state"]="ready";role.Remove("code");UpdateJobState(job);Bump();Save();if(!selfTesting)MaybeSchedulePair(job);
   }
  }catch(HostError e){Block(jobId,gen,intentSaved?"RAM_IMPORT_UNCERTAIN":e.Code);}catch{Block(jobId,gen,intentSaved?"RAM_IMPORT_UNCERTAIN":"CUSTOMER_VERIFICATION_UNAVAILABLE");}
 }
}

