using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static partial class Host {
 // Only this private, randomly named Chrome profile is controlled. Its DevTools
 // endpoint is read from the profile Chrome itself just created, never from a
 // conventional/debugging port or the user's normal browser session.
 enum ChromeOperation { Ready, Fill, CheckFilled, Submit, Issue }
 sealed class ChromeNavigationPending:Exception {}
 interface IChromeLoginBrowser:IDisposable {
  bool Alive {get;}
  Uri PageUri {get;}
  object Evaluate(ChromeOperation operation,string username,string password);
  string Cookie();
 }
 static string ChromeExecutable(){
  foreach(var folder in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}){
   if(String.IsNullOrEmpty(folder))continue;var path=Path.Combine(folder,"Google","Chrome","Application","chrome.exe");if(File.Exists(path))return path;
  }return null;
 }
 static bool ChromeAvailable(){try{return ChromeExecutable()!=null;}catch{return false;}}
 static readonly object ChromeRegistryGate=new object();
 static readonly HashSet<IChromeLoginBrowser> ChromeBrowsers=new HashSet<IChromeLoginBrowser>();
 static volatile bool chromeShuttingDown;
 static void ShutdownChromeLogins(){
  IChromeLoginBrowser[] browsers;lock(ChromeRegistryGate){chromeShuttingDown=true;browsers=new IChromeLoginBrowser[ChromeBrowsers.Count];ChromeBrowsers.CopyTo(browsers);}
  foreach(var browser in browsers)try{browser.Dispose();}catch{}
 }
 static bool ChromeCurrent(string jobId,string gen){lock(Gate){return Current(jobId,gen);}}
 static string ObtainChromeSession(string jobId,string gen,string username,ref string password){
  IChromeLoginBrowser browser=null;try{
   if(!ChromeCurrent(jobId,gen))return null;SetLoginPhase(jobId,gen,"chrome_starting");
   browser=new OwnedChromeBrowser(()=>ChromeCurrent(jobId,gen));
   return ChromeLoginFlow(browser,username,ref password,()=>ChromeCurrent(jobId,gen),p=>SetLoginPhase(jobId,gen,p),c=>Block(jobId,gen,c),v=>MarkSubmission(jobId,gen,v),()=>DateTime.UtcNow,ms=>Thread.Sleep(ms));
  }catch(HostError e){if(ChromeCurrent(jobId,gen))Block(jobId,gen,e.Code);return null;}
  catch{if(ChromeCurrent(jobId,gen))Block(jobId,gen,"CHROME_DEBUG_UNAVAILABLE");return null;}
  finally{password=null;if(browser!=null)try{browser.Dispose();}catch{}}
 }
 static bool ChromeTrustedPage(Uri uri){return uri!=null && uri.Scheme=="https" && String.IsNullOrEmpty(uri.UserInfo) && uri.IsDefaultPort && (uri.Host.Equals("roblox.com",StringComparison.OrdinalIgnoreCase)||uri.Host.EndsWith(".roblox.com",StringComparison.OrdinalIgnoreCase));}
 static bool ChromeInitialBlank(Uri uri){return uri!=null&&uri.AbsoluteUri=="about:blank";}
 static bool ChromeManualIssue(string code){return code=="CUSTOMER_CAPTCHA_REQUIRED"||code=="CUSTOMER_OTP_REQUIRED"||code=="CUSTOMER_PHONE_VERIFICATION"||code=="CUSTOMER_IDENTITY_VERIFICATION";}
 static bool ChromeSafeNoClick(string result){return result=="PENDING"||result=="EMPTY"||result=="MISSING"||result=="CHALLENGE";}
 static string ChromeLoginFlow(IChromeLoginBrowser browser,string username,ref string password,Func<bool> current,Action<string> phase,Action<string> block,Func<bool,bool> mark,Func<DateTime> clock,Action<int> pause){
  bool submitted=false,filled=false,trustedPageSeen=false;int fills=0;string lastIssue=null;DateTime formDeadline=clock().AddSeconds(60),initialNavigationDeadline=clock().AddSeconds(20),humanDeadline=DateTime.MaxValue;
  phase("chrome_loading");
  while(current()){try{
   if(clock()>=formDeadline)password=null;
   if(!browser.Alive){block("CHROME_SESSION_CLOSED");return null;}
   var page=browser.PageUri;if(!ChromeTrustedPage(page)){
    // The selected private target may report its initial document while Chrome
    // starts navigation. Wait only before its first trusted page, without any
    // cookie or form access; later blank/external navigations remain denied.
    if(!trustedPageSeen&&ChromeInitialBlank(page)){
     if(clock()>=initialNavigationDeadline){block("LOGIN_FORM_TIMEOUT");return null;}
     pause(500);continue;
    }
    block("CHROME_NAVIGATION_DENIED");return null;
   }trustedPageSeen=true;
   // Cookies are read only for the fixed Roblox URL and never enter the ledger,
   // command arguments, diagnostic text, or an import call in this module.
   string cookie=browser.Cookie();
   if(!String.IsNullOrEmpty(cookie)){
    if(!current())return null;
    try{ChromeVerifyCookie(cookie,username,current,pause);if(!current())return null;phase("chrome_verified");return cookie;}
    catch(HostError e){if(current())block(e.Code);return null;}
    finally{cookie=null;}
   }
   string issue=Convert.ToString(browser.Evaluate(ChromeOperation.Issue,null,null),CultureInfo.InvariantCulture);
   if(issue=="LOCATION_CHANGED"){block("CHROME_NAVIGATION_DENIED");return null;}
   if(!String.IsNullOrEmpty(issue)){
    lastIssue=issue;block(issue);
    if(!ChromeManualIssue(issue))return null;
    phase("chrome_verification");if(humanDeadline==DateTime.MaxValue)humanDeadline=clock().AddMinutes(10);
   }
   var now=clock();
   if((submitted||humanDeadline!=DateTime.MaxValue) && now>=humanDeadline){block(lastIssue??"CUSTOMER_LOGIN_TIMEOUT");return null;}
   if(!submitted && humanDeadline==DateTime.MaxValue && now>=formDeadline){block(lastIssue??(filled?"LOGIN_SUBMIT_TIMEOUT":"LOGIN_FORM_TIMEOUT"));return null;}
   if(!submitted && password!=null && String.IsNullOrEmpty(issue) && now<formDeadline && IsLoginPage(page)){
    string status=Convert.ToString(browser.Evaluate(ChromeOperation.CheckFilled,username,password),CultureInfo.InvariantCulture);
    if(status=="LOCATION_CHANGED"){block("CHROME_NAVIGATION_DENIED");return null;}
    if(status=="MISMATCH"){block("LOGIN_FORM_CHANGED");return null;}
    if(status=="MATCHED")filled=true;
    else if(status=="EMPTY"||status=="MISSING"){
     filled=false;
     if(Object.Equals(browser.Evaluate(ChromeOperation.Ready,null,null),true)){
      if(fills>=3){block("LOGIN_FORM_CHANGED");return null;}
      if(!current())return null;phase("chrome_filling");fills++;
      var result=browser.Evaluate(ChromeOperation.Fill,username,password);
      if(Object.Equals(result,"LOCATION_CHANGED")){block("CHROME_NAVIGATION_DENIED");return null;}
      // A later DOM tick must confirm controlled inputs kept their values.
      if(!Object.Equals(result,true)&&!Object.Equals(result,false)){block("LOGIN_FORM_CHANGED");return null;}
     }
    }else if(status!="CHALLENGE"){block("LOGIN_FORM_CHANGED");return null;}
    if(filled){
     if(!current()||!mark(true))return null;
     // Persist the submission boundary before dispatch. Only explicit results
     // proving no click occurred permit another attempt; unknown outcomes stop.
     submitted=true;phase("chrome_submitting");humanDeadline=clock().AddMinutes(10);
     string result=null;try{result=Convert.ToString(browser.Evaluate(ChromeOperation.Submit,username,password),CultureInfo.InvariantCulture);}
     catch{password=null;block("LOGIN_FORM_CHANGED");return null;}
     if(ChromeSafeNoClick(result)){
      submitted=false;if(!mark(false))return null;humanDeadline=lastIssue==null?DateTime.MaxValue:humanDeadline;
      if(result=="EMPTY"||result=="MISSING")filled=false;
     }else if(result=="CLICKED"){password=null;phase("chrome_verification");}
     else{password=null;block(result=="LOCATION_CHANGED"?"CHROME_NAVIGATION_DENIED":"LOGIN_FORM_CHANGED");return null;}
    }
   }
   pause(500);
  }catch(ChromeNavigationPending){
   if(clock()>=formDeadline)password=null;
   var deadline=humanDeadline==DateTime.MaxValue?formDeadline:humanDeadline;
   if(clock()>=deadline){block(lastIssue??(submitted?"CUSTOMER_LOGIN_TIMEOUT":filled?"LOGIN_SUBMIT_TIMEOUT":"LOGIN_FORM_TIMEOUT"));return null;}
   pause(500);
  }}password=null;return null;
 }
 static bool ChromeTransientAuthentication(Exception error){
  var web=error as WebException;if(web==null)return false;var response=web.Response as HttpWebResponse;
  if(response!=null){int status=(int)response.StatusCode;return status==408||status==429||status>=500;}
  return web.Status==WebExceptionStatus.Timeout||web.Status==WebExceptionStatus.ConnectFailure||web.Status==WebExceptionStatus.ConnectionClosed||web.Status==WebExceptionStatus.ReceiveFailure||web.Status==WebExceptionStatus.SendFailure||web.Status==WebExceptionStatus.NameResolutionFailure;
 }
 static void ChromeVerifyCookie(string cookie,string username,Func<bool> current,Action<int> pause){
  for(int attempt=0;attempt<3;attempt++){
   if(!current())return;
   try{var identity=authenticate(cookie);long id;Require(Int64.TryParse(S(identity,"id"),out id)&&id>0&&String.Equals(S(identity,"name"),username,StringComparison.OrdinalIgnoreCase),"CUSTOMER_ID_MISMATCH");return;}
   catch(HostError){throw;}
   catch(Exception error){if(attempt==2||!ChromeTransientAuthentication(error))throw new HostError("CUSTOMER_VERIFICATION_UNAVAILABLE");pause(300*(attempt+1));}
  }
 }
 static string ChromeExpression(ChromeOperation operation,string username,string password){
  string expression;
  switch(operation){
   case ChromeOperation.Ready:expression=LoginFormScripts.Ready;break;
   case ChromeOperation.Fill:expression=LoginFormScripts.Fill(J.Serialize(username),J.Serialize(password));break;
   case ChromeOperation.CheckFilled:expression=LoginFormScripts.CheckFilled(J.Serialize(username),J.Serialize(password));break;
   case ChromeOperation.Submit:expression=LoginFormScripts.SubmitChecked(J.Serialize(username),J.Serialize(password));break;
   case ChromeOperation.Issue:expression=LoginFormScripts.Issue;break;
   default:throw new HostError("CHROME_DEBUG_UNAVAILABLE");
  }
  // The location test and credential operation execute atomically in one JS
  // turn, preventing a navigation between a native URL check and form access.
  const string trusted="location.protocol==='https:'&&location.port===''&&(location.hostname==='roblox.com'||location.hostname.endsWith('.roblox.com'))";
  const string login=@"(location.hostname==='roblox.com'||location.hostname==='www.roblox.com')&&/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?login\/?$/i.test(location.pathname)";
  bool credentials=operation==ChromeOperation.Fill||operation==ChromeOperation.CheckFilled||operation==ChromeOperation.Submit||operation==ChromeOperation.Ready;
  return "(()=>{if(!("+trusted+(credentials?"&&"+login:"")+"))return 'LOCATION_CHANGED';return "+expression+";})()";
 }
 sealed class ChromeEndpoint {
  internal int Port;internal string BrowserPath;
  internal static ChromeEndpoint Parse(string contents){
   Require(contents!=null&&contents.Length<=256,"CHROME_DEBUG_UNAVAILABLE");var lines=contents.Replace("\r","").Split('\n');int port=0;
   Require(lines.Length>=2&&lines.Length<=3&&Int32.TryParse(lines[0],NumberStyles.None,CultureInfo.InvariantCulture,out port)&&port>=1024&&port<=65535&&Regex.IsMatch(lines[1],@"^/devtools/browser/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")&&(lines.Length!=3||lines[2]==""),"CHROME_DEBUG_UNAVAILABLE");
   return new ChromeEndpoint{Port=port,BrowserPath=lines[1]};
  }
  internal Uri Socket(string path){var uri=new Uri("ws://127.0.0.1:"+Port.ToString(CultureInfo.InvariantCulture)+path);Require(TrustedSocket(uri,Port,path),"CHROME_DEBUG_UNAVAILABLE");return uri;}
  internal static bool TrustedSocket(Uri uri,int port,string path){return uri!=null&&uri.Scheme=="ws"&&uri.Host=="127.0.0.1"&&uri.Port==port&&String.IsNullOrEmpty(uri.UserInfo)&&String.IsNullOrEmpty(uri.Query)&&String.IsNullOrEmpty(uri.Fragment)&&uri.AbsolutePath==path;}
 }
 sealed class ChromeCdp:IDisposable {
  const int FrameLimit=262144;readonly ClientWebSocket socket=new ClientWebSocket();int nextId;
  internal ChromeCdp(Uri endpoint){socket.Options.Proxy=null;using(var timeout=new CancellationTokenSource(3000)){socket.ConnectAsync(endpoint,timeout.Token).GetAwaiter().GetResult();}}
  internal Dictionary<string,object> Call(string method,Dictionary<string,object> args){
   int id=++nextId;byte[] request=Encoding.UTF8.GetBytes(J.Serialize(Obj("id",id,"method",method,"params",args??Obj())));
   try{Require(request.Length<=16384,"CHROME_DEBUG_UNAVAILABLE");using(var timeout=new CancellationTokenSource(4000)){
    socket.SendAsync(new ArraySegment<byte>(request),WebSocketMessageType.Text,true,timeout.Token).GetAwaiter().GetResult();
    for(int messages=0;messages<128;messages++){
     var message=Receive(timeout.Token);if(S(message,"id")!=id.ToString(CultureInfo.InvariantCulture))continue;
     if(message.ContainsKey("error")){
      var error=D(message["error"]);string detail=S(error,"message");
      if(method=="Runtime.evaluate"&&S(error,"code")=="-32000"&&(detail=="Execution context was destroyed."||detail=="Cannot find context with specified id"||detail.StartsWith("Execution context was destroyed,",StringComparison.Ordinal)))throw new ChromeNavigationPending();
      throw new HostError("CHROME_DEBUG_UNAVAILABLE");
     }var result=D(message.ContainsKey("result")?message["result"]:null);Require(result!=null,"CHROME_DEBUG_UNAVAILABLE");return result;
    }throw new HostError("CHROME_DEBUG_UNAVAILABLE");
   }}finally{Array.Clear(request,0,request.Length);}
  }
  Dictionary<string,object> Receive(CancellationToken token){
   byte[] buffer=new byte[8192];using(var stream=new MemoryStream()){
    try{WebSocketReceiveResult frame;do{frame=socket.ReceiveAsync(new ArraySegment<byte>(buffer),token).GetAwaiter().GetResult();Require(frame.MessageType==WebSocketMessageType.Text&&stream.Length+frame.Count<=FrameLimit,"CHROME_DEBUG_UNAVAILABLE");stream.Write(buffer,0,frame.Count);}while(!frame.EndOfMessage);
     byte[] bytes=stream.ToArray();try{var result=D(J.DeserializeObject(new UTF8Encoding(false,true).GetString(bytes)));Require(result!=null,"CHROME_DEBUG_UNAVAILABLE");return result;}finally{Array.Clear(bytes,0,bytes.Length);}
    }finally{Array.Clear(buffer,0,buffer.Length);}
   }
  }
  public void Dispose(){try{socket.Abort();}catch{}socket.Dispose();}
 }
 sealed class OwnedChromeBrowser:IChromeLoginBrowser {
  readonly object lifetimeGate=new object();Process process;long started;int processId;string executablePath,profile,profileRoot;ChromeEndpoint endpoint;ChromeCdp page;string targetId;bool disposed;
  internal OwnedChromeBrowser(Func<bool> current){lock(lifetimeGate){try{
   // Registration precedes every resource and process. Shutdown publishes its
   // gate before disposing the snapshot, so a constructor cannot start later.
   lock(ChromeRegistryGate){Require(!chromeShuttingDown,"CHROME_CANCELLED");ChromeBrowsers.Add(this);}
   executablePath=ChromeExecutable();Require(executablePath!=null,"CHROME_UNAVAILABLE");executablePath=Path.GetFullPath(executablePath);
   Require(!String.IsNullOrEmpty(ledgerPath),"CHROME_START_FAILED");profileRoot=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(ledgerPath),"chrome-profiles"));Directory.CreateDirectory(profileRoot);
   Require((File.GetAttributes(profileRoot)&FileAttributes.ReparsePoint)==0,"CHROME_START_FAILED");profile=Path.Combine(profileRoot,NewId());Directory.CreateDirectory(profile);
   var defaultProfile=Path.Combine(profile,"Default");Directory.CreateDirectory(defaultProfile);
   File.WriteAllText(Path.Combine(defaultProfile,"Preferences"),J.Serialize(Obj("credentials_enable_service",false,"profile",Obj("password_manager_enabled",false,"password_manager_leak_detection",false),"autofill",Obj("profile_enabled",false,"credit_card_enabled",false))),new UTF8Encoding(false));
   var start=new ProcessStartInfo(executablePath,"--user-data-dir=\""+profile+"\" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --new-window https://www.roblox.com/login");start.UseShellExecute=false;start.RedirectStandardOutput=true;start.RedirectStandardError=true;start.CreateNoWindow=true;
   lock(ChromeRegistryGate){Require(current(),"CHROME_CANCELLED");Require(!chromeShuttingDown&&!disposed,"CHROME_CANCELLED");process=Process.Start(start);Require(process!=null,"CHROME_START_FAILED");processId=process.Id;started=process.StartTime.ToUniversalTime().Ticks;}process.BeginOutputReadLine();process.BeginErrorReadLine();
   DateTime deadline=DateTime.UtcNow.AddSeconds(20);var portFile=Path.Combine(profile,"DevToolsActivePort");
   while(DateTime.UtcNow<deadline&&!chromeShuttingDown&&current()&&Alive){
    if(endpoint==null&&File.Exists(portFile)){
     Require((File.GetAttributes(portFile)&FileAttributes.ReparsePoint)==0,"CHROME_DEBUG_UNAVAILABLE");
     try{using(var file=new FileStream(portFile,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)){Require(file.Length<=256,"CHROME_DEBUG_UNAVAILABLE");if(file.Length>0)using(var reader=new StreamReader(file,Encoding.UTF8))endpoint=ChromeEndpoint.Parse(reader.ReadToEnd());}}catch(IOException){}catch(HostError){}
    }
    if(endpoint!=null){try{
     // The browser socket must accept this exact private GUID before /json/list
     // is trusted. A stale or unrelated local debugging service is rejected.
     using(var browser=new ChromeCdp(endpoint.Socket(endpoint.BrowserPath)))browser.Call("Browser.getVersion",Obj());
     var targets=A(J.DeserializeObject(ReadChromeTargets(endpoint.Port)));Dictionary<string,object> selected=null;
     foreach(var value in targets){var candidate=D(value);Uri uri;if(S(candidate,"type")!="page"||!Uri.TryCreate(S(candidate,"url"),UriKind.Absolute,out uri)||!IsLoginPage(uri))continue;Require(selected==null,"CHROME_DEBUG_UNAVAILABLE");selected=candidate;}
     if(selected!=null){targetId=S(selected,"id");Require(Regex.IsMatch(targetId,@"^[0-9a-fA-F]{32}$"),"CHROME_DEBUG_UNAVAILABLE");string path="/devtools/page/"+targetId;Uri socket;Require(Uri.TryCreate(S(selected,"webSocketDebuggerUrl"),UriKind.Absolute,out socket)&&ChromeEndpoint.TrustedSocket(socket,endpoint.Port,path),"CHROME_DEBUG_UNAVAILABLE");page=new ChromeCdp(socket);return;}
    }catch(HostError){throw;}catch{}}
    Thread.Sleep(150);
   }
   if(chromeShuttingDown||!current())throw new HostError("CHROME_CANCELLED");throw new HostError(Alive?"CHROME_DEBUG_UNAVAILABLE":"CHROME_SESSION_CLOSED");
  }catch{Dispose();throw;}}}
  bool ProcessAlive(){try{return process!=null&&!process.HasExited&&process.Id==processId&&process.StartTime.ToUniversalTime().Ticks==started;}catch{return false;}}
  bool ProcessExited(){try{return process==null||process.HasExited;}catch{return false;}}
  bool TrustedOwnedProcess(){try{return ProcessAlive()&&String.Equals(Path.GetFullPath(process.MainModule.FileName),executablePath,StringComparison.OrdinalIgnoreCase);}catch{return false;}}
  internal int ProcessId {get{lock(lifetimeGate){return processId;}}}
  internal long ProcessStartTicks {get{lock(lifetimeGate){return started;}}}
  public bool Alive {get{lock(lifetimeGate){return !disposed&&ProcessAlive();}}}
  static string ReadChromeTargets(int port){
   var request=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:"+port.ToString(CultureInfo.InvariantCulture)+"/json/list");request.Proxy=null;request.AllowAutoRedirect=false;request.Timeout=1500;request.ReadWriteTimeout=1500;
   using(var response=(HttpWebResponse)request.GetResponse()){Require(response.StatusCode==HttpStatusCode.OK,"CHROME_DEBUG_UNAVAILABLE");using(var stream=response.GetResponseStream())using(var memory=new MemoryStream()){
    byte[] buffer=new byte[4096];int count;try{while((count=stream.Read(buffer,0,buffer.Length))>0){Require(memory.Length+count<=262144,"CHROME_DEBUG_UNAVAILABLE");memory.Write(buffer,0,count);}return new UTF8Encoding(false,true).GetString(memory.ToArray());}finally{Array.Clear(buffer,0,buffer.Length);}
   }}
  }
  object EvaluateFixed(string expression){
   lock(lifetimeGate){Require(Alive&&page!=null,"CHROME_SESSION_CLOSED");var response=page.Call("Runtime.evaluate",Obj("expression",expression,"returnByValue",true,"awaitPromise",false));Require(!response.ContainsKey("exceptionDetails"),"CHROME_DEBUG_UNAVAILABLE");var result=D(response.ContainsKey("result")?response["result"]:null);Require(result!=null&&result.ContainsKey("value"),"CHROME_DEBUG_UNAVAILABLE");return result["value"];}
  }
  public Uri PageUri {get{Uri uri;return Uri.TryCreate(Convert.ToString(EvaluateFixed("location.href"),CultureInfo.InvariantCulture),UriKind.Absolute,out uri)?uri:null;}}
  public object Evaluate(ChromeOperation operation,string username,string password){string expression=ChromeExpression(operation,username,password);try{return EvaluateFixed(expression);}finally{expression=null;}}
  public string Cookie(){
   lock(lifetimeGate){
   // Repeat the location guard immediately before and after the cookie read.
   Require(ChromeTrustedPage(PageUri),"CHROME_NAVIGATION_DENIED");var response=page.Call("Network.getCookies",Obj("urls",new object[]{"https://www.roblox.com/"}));string cookie=null;
   foreach(var value in A(response.ContainsKey("cookies")?response["cookies"]:null)){
    var item=D(value);if(S(item,"name")!=".ROBLOSECURITY")continue;
    string domain=S(item,"domain");Require((domain==".roblox.com"||domain=="roblox.com"||domain=="www.roblox.com")&&S(item,"path")=="/","CHROME_DEBUG_UNAVAILABLE");
    string token=S(item,"value");if(String.IsNullOrEmpty(token))continue;Require(cookie==null&&token.Length<=16384&&token.IndexOfAny(new[]{'\r','\n',';'})<0&&S(item,"secure")=="True","CHROME_DEBUG_UNAVAILABLE");cookie=token;
   }Require(ChromeTrustedPage(PageUri),"CHROME_NAVIGATION_DENIED");return cookie;}
  }
  public void Dispose(){
   lock(lifetimeGate){
    if(disposed&&process==null&&(String.IsNullOrEmpty(profile)||!Directory.Exists(profile)))return;disposed=true;
    if(page!=null){try{page.Dispose();}catch{}page=null;}
    if(ProcessAlive()){
     try{if(endpoint!=null){using(var browser=new ChromeCdp(endpoint.Socket(endpoint.BrowserPath)))browser.Call("Browser.close",Obj());}}catch{}
     if(ProcessAlive())try{process.CloseMainWindow();}catch{}
     try{process.WaitForExit(3000);}catch{}
     // Never enumerate, kill by name, or terminate another Chrome session.
     // This handle must still match the PID, start time and executable launched
     // above before a graceful-close failure permits terminating that process.
     if(TrustedOwnedProcess())try{process.Kill();process.WaitForExit(3000);}catch{}
    }
    if(ProcessExited()){
     if(process!=null){process.Dispose();process=null;}
     for(int attempt=0;attempt<10;attempt++){try{ChromeDeleteProfile(profileRoot,profile);break;}catch{if(attempt<9)Thread.Sleep(100);}}
     if(String.IsNullOrEmpty(profile)||!Directory.Exists(profile))lock(ChromeRegistryGate){ChromeBrowsers.Remove(this);}
    }
    // A process which could not be stopped stays registered for a later host
    // shutdown retry, with its profile retained rather than deleted in use.
   }
  }
 }
 static void ChromeDeleteProfile(string root,string profile){
  if(String.IsNullOrEmpty(root)||String.IsNullOrEmpty(profile))return;string canonicalRoot=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar),target=Path.GetFullPath(profile);
  Require(String.Equals(Path.GetDirectoryName(target),canonicalRoot,StringComparison.OrdinalIgnoreCase)&&Regex.IsMatch(Path.GetFileName(target),@"^[0-9a-f]{32}$"),"PROFILE_PATH_INVALID");
  if(!Directory.Exists(target))return;Require((File.GetAttributes(canonicalRoot)&FileAttributes.ReparsePoint)==0,"PROFILE_PATH_INVALID");ChromeCheckProfileTree(target);Directory.Delete(target,true);
 }
 static void ChromeCheckProfileTree(string folder){Require((File.GetAttributes(folder)&FileAttributes.ReparsePoint)==0,"PROFILE_PATH_INVALID");foreach(var path in Directory.GetFileSystemEntries(folder)){Require((File.GetAttributes(path)&FileAttributes.ReparsePoint)==0,"PROFILE_PATH_INVALID");if(Directory.Exists(path))ChromeCheckProfileTree(path);}}
}
