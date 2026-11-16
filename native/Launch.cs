using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web;
using Microsoft.Win32;

internal static partial class Host {
 sealed class PairAccount { public string Id,Cookie,Place,PrivateUrl; }
 sealed class PairPrepared { public PairAccount Account; public string Ticket,Protocol; }
 sealed class PairOwned { public int Pid; public long StartTicks; public string Role; }
 sealed class PairEvidence { public string Place,Server,Sequence,LogName; public bool Connected; }
 sealed class PairAttempt { public string Role,Sequence; public PairPrepared Prepared; public DateTime Since; public bool Dispatched,Found; }
 sealed class PairRun {
  public string JobId,Generation,OperatorId,CustomerId,Place,SourceId;
  public bool Cancel,Active,Uncertain,Cleaned; public readonly List<PairOwned> Owned=new List<PairOwned>();
  public readonly List<PairAttempt> Attempts=new List<PairAttempt>(); public readonly ManualResetEvent Done=new ManualResetEvent(false);
 }
 sealed class PairServices {
  public Func<object[]> Accounts=ReadAccounts;
  public Action Preflight=PairPreflight;
  public Func<PairAccount,PairPrepared> Prepare=PairPrepare;
  public Action<PairPrepared> Start=p=>{using(var process=Process.Start(new ProcessStartInfo(p.Protocol){UseShellExecute=true})){};};
  public Func<string,DateTime,List<PairOwned>> Discover=PairDiscover;
  public Func<PairOwned,bool> Alive=PairAlive;
  public Action<PairOwned> Close=PairClose;
  public Func<PairAccount,DateTime,PairOwned,PairEvidence> Evidence=PairReadEvidence;
  public Func<DateTime> Now=()=>DateTime.UtcNow;
  public Action<int> Wait=Thread.Sleep;
  public Action Persist=()=>{Bump();Save();};
  public int JoinSeconds=75,DiscoverySeconds=15,CloseSeconds=15;
 }
 static PairServices pairServices=new PairServices();
 static readonly object MultiOwnerSync=new object(); static Thread multiOwnerThread; static Mutex multiOwnerMutex; static string multiOwnerState="pending";
 // Roblox lets several clients coexist only while something else owns the
 // singleton mutex (RAM holds it the same way). Ownership is thread-affine, so
 // a dedicated thread acquires it once and sleeps for the process lifetime.
 static string EnsureMultiClientOwner(){
  lock(MultiOwnerSync){
   if(multiOwnerThread!=null)return multiOwnerState;
   var ready=new ManualResetEvent(false);var thread=new Thread(()=>{
    try{
     var mutex=new Mutex(false,"ROBLOX_singletonMutex");bool acquired;
     try{acquired=mutex.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
     if(!acquired){multiOwnerState="external";ready.Set();mutex.Dispose();return;}
     multiOwnerMutex=mutex;multiOwnerState="owned";ready.Set();Thread.Sleep(Timeout.Infinite);
    }catch{multiOwnerState="unavailable";ready.Set();}
   });
   thread.IsBackground=true;thread.Name="BewQueue multi-client owner";multiOwnerThread=thread;thread.Start();ready.WaitOne(5000);
   return multiOwnerState;
  }
 }
 static readonly Dictionary<string,PairRun> pairRuns=new Dictionary<string,PairRun>();
 static string PairKey(string id,string gen){return id+":"+gen;}
 static bool PairCurrent(PairRun run){var job=D(ledger["current"]);return job!=null && S(job,"jobId")==run.JobId && S(job,"generation")==run.Generation;}
 static Dictionary<string,object> PairGame(Dictionary<string,object> job,string role){var r=D(job[role]);if(!r.ContainsKey("game"))r["game"]=Obj("state","waiting");return D(r["game"]);}
 static void PairPersist(){var current=D(ledger["current"]);if(current!=null)UpdateJobState(current);pairServices.Persist();}
 static void PairProblem(PairRun run,string code){lock(Gate){if(!PairCurrent(run))return;var j=D(ledger["current"]);var state=D(j["launchPair"]);state["state"]="blocked";state["code"]=code;state["ownershipUncertain"]=run.Uncertain;foreach(var role in new[]{"operator","customer"}){var g=PairGame(j,role);if(S(g,"state")!="closed"){g["state"]="blocked";g["code"]=code;}}PairPersist();}}
 static void PairCheck(PairRun run){lock(Gate){Require(PairCurrent(run) && !run.Cancel,"PAIR_CANCELLED");}}
 static Dictionary<string,object> LaunchPair(Dictionary<string,object> payload){
  var job=D(ledger["current"]);Require(job!=null && S(job,"jobId")==S(payload,"jobId") && S(job,"generation")==S(payload,"generation"),"STALE_JOB");
  Require(S(D(job["operator"]),"state")=="ready" && S(D(job["customer"]),"state")=="ready" && !job.ContainsKey("importIntent"),"PAIR_SESSIONS_NOT_READY");
  MaybeSchedulePair(job);return Snapshot();
 }
 static void MaybeSchedulePair(Dictionary<string,object> job){
  if(job==null || S(D(job["operator"]),"state")!="ready" || S(D(job["customer"]),"state")!="ready" || job.ContainsKey("importIntent"))return;
  string id=S(job,"jobId"),gen=S(job,"generation"),key=PairKey(id,gen);if(pairRuns.ContainsKey(key))return;
  // A durable attempt without its worker is recovery, never permission to spawn again.
  if(job.ContainsKey("launchPair")){var old=D(job["launchPair"]);if(old!=null && S(old,"state")!="waiting")return;}
  var order=D(job["order"]);var run=new PairRun{JobId=id,Generation=gen,OperatorId=S(D(job["operator"]),"userId"),CustomerId=S(D(job["customer"]),"userId"),Place=S(order,"placeId"),SourceId=S(order,"privateServerSourceUserId"),Active=true};
  job["launchPair"]=Obj("state","preparing","attempted",false,"ownershipUncertain",false,"cleanup","waiting");
  foreach(string role in new[]{"operator","customer"}){var g=PairGame(job,role);g.Clear();g["state"]="preparing";g["placeId"]=run.Place;}
  pairRuns.Add(key,run);PairPersist();var worker=new Thread(()=>PairWorker(run));worker.IsBackground=true;worker.Name="BewQueue pair launcher";worker.Start();
 }
 static PairAccount PairAccountFrom(object[] accounts,string id,string place,string target){
  long n;Require(Int64.TryParse(id,out n)&&n>0&&n.ToString()==id,"PAIR_ACCOUNT_INVALID");var matching=accounts.Select(D).Where(a=>a!=null&&S(a,"UserID")==id).ToArray();Require(matching.Length==1,"PAIR_ACCOUNT_MISSING");
  string cookie=S(matching[0],"SecurityToken");Require(!String.IsNullOrWhiteSpace(cookie),"PAIR_SESSION_INVALID");return new PairAccount{Id=id,Cookie=cookie,Place=place,PrivateUrl=target};
 }
 static string PairPrivateTarget(object[] accounts,string source,string place){
  long n;Require(Int64.TryParse(place,out n)&&n>0&&n.ToString()==place,"PAIR_TARGET_INVALID");var a=accounts.Select(D).Where(x=>x!=null&&S(x,"UserID")==source).ToArray();Require(a.Length==1,"PRIVATE_TARGET_MISSING");
  var fields=D(a[0].ContainsKey("Fields")?a[0]["Fields"]:null);Require(S(fields,"SavedPlaceId")==place,"PRIVATE_TARGET_MAP_MISMATCH");string target=S(fields,"SavedJobId");Uri u;
  Require(Uri.TryCreate(target,UriKind.Absolute,out u)&&u.Scheme=="https"&&u.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase)&&u.Port==443&&String.IsNullOrEmpty(u.UserInfo)&&String.IsNullOrEmpty(u.Fragment)&&Regex.IsMatch(u.AbsolutePath,@"^/games/"+Regex.Escape(place)+@"(?:/[^/?#]*)?/?$"),"PRIVATE_TARGET_INVALID");
  var q=HttpUtility.ParseQueryString(u.Query);string code=q["privateServerLinkCode"];Require(!String.IsNullOrWhiteSpace(code)&&code.Length<=256&&Regex.IsMatch(code,@"^[A-Za-z0-9_-]+$")&&q.GetValues("privateServerLinkCode").Length==1,"PRIVATE_TARGET_INVALID");
  return "https://www.roblox.com/games/"+place+"?privateServerLinkCode="+Uri.EscapeDataString(code);
 }
 static void PairWorker(PairRun run){
  try{
   PairCheck(run);pairServices.Preflight();PairCheck(run);var accounts=pairServices.Accounts();Require(run.OperatorId!=run.CustomerId,"ROLE_CONFLICT");string target=PairPrivateTarget(accounts,run.SourceId,run.Place);
   var op=PairAccountFrom(accounts,run.OperatorId,run.Place,target);var customer=PairAccountFrom(accounts,run.CustomerId,run.Place,target);
   lock(Gate){Require(PairCurrent(run)&&!run.Cancel,"PAIR_CANCELLED");var protectedIds=A(D(ledger["current"]).ContainsKey("protectedOperatorUserIds")?D(ledger["current"])["protectedOperatorUserIds"]:null);Require(!protectedIds.Any(v=>Convert.ToString(v)==run.CustomerId),"ROLE_CONFLICT");}
   foreach(var entry in new[]{new KeyValuePair<string,PairAccount>("operator",op),new KeyValuePair<string,PairAccount>("customer",customer)}){
    PairCheck(run);var prepared=pairServices.Prepare(entry.Value);Require(prepared!=null && !String.IsNullOrEmpty(prepared.Ticket),"PAIR_TICKET_MISSING");PairCheck(run);
    var attempt=new PairAttempt{Role=entry.Key,Prepared=prepared,Since=pairServices.Now()};
    lock(Gate){Require(PairCurrent(run)&&!run.Cancel,"PAIR_CANCELLED");run.Attempts.Add(attempt);var j=D(ledger["current"]);D(j["launchPair"])["attempted"]=true;D(j["launchPair"])["ownershipUncertain"]=true;PairGame(j,entry.Key)["attempted"]=true;PairPersist();
     // Cancellation and dispatch share Gate. An intent is durable before the shell call.
     attempt.Dispatched=true;pairServices.Start(prepared);
    }
    var deadline=attempt.Since.AddSeconds(pairServices.JoinSeconds);PairEvidence evidence=null;
    while(pairServices.Now()<deadline){PairCheck(run);PairCollect(run,attempt);var owned=run.Owned.Where(x=>x.Role==entry.Key).ToArray();if(owned.Length==1){Require(pairServices.Alive(owned[0]),"PAIR_CLIENT_EXITED");evidence=pairServices.Evidence(entry.Value,attempt.Since,owned[0]);if(evidence!=null&&evidence.Connected){Require(evidence.Place==run.Place,"PAIR_WRONG_MAP");break;}}pairServices.Wait(500);}
    Require(attempt.Found,"PAIR_LAUNCH_OWNERSHIP_UNCONFIRMED");Require(evidence!=null&&evidence.Connected,"PAIR_CONNECTION_UNCONFIRMED");Require(!String.IsNullOrEmpty(evidence.Server),"PAIR_SERVER_INSTANCE_UNCONFIRMED");
    Require(!String.IsNullOrEmpty(evidence.Sequence),"PAIR_LOG_SEQUENCE_UNCONFIRMED");attempt.Sequence=evidence.Sequence;
    lock(Gate){Require(PairCurrent(run)&&!run.Cancel,"PAIR_CANCELLED");var game=PairGame(D(ledger["current"]),entry.Key);game["state"]="connected";game.Remove("code");game["serverInstanceId"]=evidence.Server;PairPersist();}
    prepared.Protocol=null;prepared.Account.Cookie=null;prepared.Account.PrivateUrl=null;
   }
   // The operator's first evidence can be old by the time the customer joins.
   // Refresh both owned processes and their current join sequences at the barrier.
   var refreshed=new Dictionary<string,PairEvidence>();foreach(var a in run.Attempts){PairCheck(run);var owned=run.Owned.Where(x=>x.Role==a.Role).ToArray();Require(owned.Length==1&&pairServices.Alive(owned[0]),"PAIR_CLIENT_EXITED");var current=pairServices.Evidence(a.Prepared.Account,a.Since,owned[0]);Require(current!=null&&current.Connected,"PAIR_CONNECTION_LOST");Require(current.Place==run.Place&&!String.IsNullOrEmpty(current.Server),"PAIR_SERVER_INSTANCE_UNCONFIRMED");Require(current.Sequence==a.Sequence,"PAIR_CLIENT_SESSION_CHANGED");refreshed.Add(a.Role,current);}
   lock(Gate){Require(PairCurrent(run)&&!run.Cancel,"PAIR_CANCELLED");Require(run.Owned.Count==2&&run.Owned.Select(x=>x.Pid).Distinct().Count()==2&&run.Owned.All(pairServices.Alive),"PAIR_NOT_SIMULTANEOUS");var j=D(ledger["current"]);Require(refreshed["operator"].Server==refreshed["customer"].Server,"PAIR_DIFFERENT_SERVER");foreach(var a in run.Attempts)Require(S(PairGame(j,a.Role),"serverInstanceId")==refreshed[a.Role].Server,"PAIR_CLIENT_SESSION_CHANGED");run.Uncertain=false;var state=D(j["launchPair"]);state["state"]="connected";state["ownershipUncertain"]=false;state.Remove("code");PairPersist();}
  }catch(HostError e){if(e.Code!="PAIR_CANCELLED")PairProblem(run,e.Code);}catch{PairProblem(run,"PAIR_LAUNCH_UNAVAILABLE");}
  finally{
   // A dispatched-but-unidentified client is never silently considered closed.
  foreach(var a in run.Attempts.Where(x=>x.Dispatched&&!x.Found)){try{PairDiscoverUntil(run,a);}catch{run.Uncertain=true;}}
   foreach(var a in run.Attempts){if(a.Prepared!=null){a.Prepared.Protocol=null;a.Prepared.Ticket=null;if(a.Prepared.Account!=null){a.Prepared.Account.Cookie=null;a.Prepared.Account.PrivateUrl=null;}}}
   bool cancelled;lock(Gate){cancelled=run.Cancel;}if(cancelled)PairCleanup(run);
   lock(Gate){run.Active=false;run.Done.Set();if(PairCurrent(run)){D(D(ledger["current"])["launchPair"])["ownershipUncertain"]=run.Uncertain;PairPersist();}}
  }
 }
 static void PairCollect(PairRun run,PairAttempt attempt){
  var matches=pairServices.Discover(attempt.Prepared.Ticket,attempt.Since);foreach(var owned in matches){owned.Role=attempt.Role;lock(Gate){if(run.Owned.Any(x=>x.Pid==owned.Pid&&x.StartTicks==owned.StartTicks))continue;run.Owned.Add(owned);if(PairCurrent(run)){var g=PairGame(D(ledger["current"]),attempt.Role);g["pid"]=owned.Pid;g["startTimeUtcTicks"]=owned.StartTicks.ToString();PairPersist();}}}
  attempt.Found=run.Owned.Any(x=>x.Role==attempt.Role);if(matches.Count>1){run.Uncertain=true;throw new HostError("PAIR_MULTIPLE_CLIENTS");}
 }
 static void PairDiscoverUntil(PairRun run,PairAttempt attempt){var end=attempt.Since.AddSeconds(pairServices.DiscoverySeconds);do{PairCollect(run,attempt);if(attempt.Found)return;if(pairServices.Now()>=end)break;pairServices.Wait(250);}while(true);run.Uncertain=true;}
 static bool CloseOwnedPair(Dictionary<string,object> job){
  string key=PairKey(S(job,"jobId"),S(job,"generation"));PairRun run;
  if(!pairRuns.TryGetValue(key,out run)){
   if(!job.ContainsKey("launchPair"))return true;var saved=D(job["launchPair"]);if(saved==null||S(saved,"attempted")!="True"||S(saved,"cleanup")=="closed")return true;
   run=new PairRun{JobId=S(job,"jobId"),Generation=S(job,"generation"),Cancel=true,Uncertain=S(saved,"ownershipUncertain")=="True"};
   foreach(var role in new[]{"operator","customer"}){var g=PairGame(job,role);int pid;long ticks;if(Int32.TryParse(S(g,"pid"),out pid)&&Int64.TryParse(S(g,"startTimeUtcTicks"),out ticks)&&pid>0&&ticks>0)run.Owned.Add(new PairOwned{Role=role,Pid=pid,StartTicks=ticks});else if(S(g,"attempted")=="True")run.Uncertain=true;}
   pairRuns.Add(key,run);
  }
  run.Cancel=true;if(run.Active)return false;if(run.Cleaned&&!run.Uncertain){pairRuns.Remove(key);return true;}if(run.Uncertain&&run.Cleaned)return false;
  run.Active=true;run.Done.Reset();D(job["launchPair"])["cleanup"]="pending";PairPersist();var worker=new Thread(()=>{try{PairCleanup(run);}finally{lock(Gate){run.Active=false;run.Done.Set();}}});worker.IsBackground=true;worker.Name="BewQueue pair cleanup";worker.Start();return false;
 }
 static void PairCleanup(PairRun run){
  bool allClosed=false;try{var end=pairServices.Now().AddSeconds(pairServices.CloseSeconds);do{var alive=run.Owned.Where(pairServices.Alive).ToArray();if(alive.Length==0){allClosed=true;break;}foreach(var p in alive){try{pairServices.Close(p);}catch{}}if(pairServices.Now()>=end)break;pairServices.Wait(500);}while(true);}catch{allClosed=false;}
  lock(Gate){run.Cleaned=allClosed;if(!PairCurrent(run))return;var j=D(ledger["current"]);var s=D(j["launchPair"]);s["cleanup"]=allClosed&&!run.Uncertain?"closed":"pending";if(allClosed&&!run.Uncertain){s["state"]="closed";s.Remove("code");foreach(var role in new[]{"operator","customer"}){var g=PairGame(j,role);g["state"]="closed";g.Remove("code");}}else{s["code"]=run.Uncertain?"PAIR_CLEANUP_UNCERTAIN":"PAIR_CLEANUP_PENDING";}PairPersist();}
 }
 static bool PairAlive(PairOwned owned){try{using(var p=Process.GetProcessById(owned.Pid)){if(p.StartTime.ToUniversalTime().Ticks!=owned.StartTicks)return false;Require(p.ProcessName=="RobloxPlayerBeta","PAIR_PROCESS_IDENTITY_UNAVAILABLE");return !p.HasExited;}}catch(ArgumentException){return false;}}
 static void PairClose(PairOwned owned){using(var p=Process.GetProcessById(owned.Pid)){if(p.StartTime.ToUniversalTime().Ticks!=owned.StartTicks)return;Require(p.ProcessName=="RobloxPlayerBeta","PAIR_PROCESS_IDENTITY_UNAVAILABLE");p.CloseMainWindow();}}
 static List<PairOwned> PairDiscover(string ticket,DateTime since){
  var result=new List<PairOwned>();Require(!String.IsNullOrEmpty(ticket),"PAIR_TICKET_MISSING");using(var search=new ManagementObjectSearcher("SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='RobloxPlayerBeta.exe'"))using(var rows=search.Get()){foreach(ManagementObject row in rows){using(row){string command=Convert.ToString(row["CommandLine"]);if(!PairTicketInCommand(command,ticket))continue;using(var p=Process.GetProcessById(Convert.ToInt32(row["ProcessId"]))){long ticks=p.StartTime.ToUniversalTime().Ticks;if(ticks>=since.AddSeconds(-1).Ticks)result.Add(new PairOwned{Pid=p.Id,StartTicks=ticks});}}}}return result;
 }
 static bool PairTicketInCommand(string command,string ticket){if(String.IsNullOrEmpty(command)||String.IsNullOrEmpty(ticket))return false;return Regex.IsMatch(command,@"(?:^|\s)-t\s+""?"+Regex.Escape(ticket)+@"(?:""|\s|$)")||Regex.IsMatch(command,@"(?:^|\s|"")roblox-player:1\+launchmode:play\+gameinfo:"+Regex.Escape(ticket)+@"\+");}
 static void PairPreflight(){
  Require(Process.GetProcessesByName("RobloxPlayerBeta").Length==0,"PAIR_UNOWNED_CLIENT_PRESENT");int count=0;foreach(var p in Process.GetProcesses()){using(p){if(!IsManagerProcessName(p.ProcessName))continue;count++;Require(String.Equals(Path.GetFullPath(p.MainModule.FileName),ramExePath,StringComparison.OrdinalIgnoreCase),"RAM_RECEIVER_AMBIGUOUS");}}
  Require(count==1,"PAIR_MULTI_CLIENT_UNAVAILABLE");Require(EnsureMultiClientOwner()!="unavailable","PAIR_MULTI_CLIENT_UNAVAILABLE");string settings=Path.Combine(Path.GetDirectoryName(ramExePath),"RAMSettings.ini");var general=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);string section="";
  foreach(string raw in File.ReadAllLines(settings)){string line=raw.Trim();if(line.StartsWith("[")&&line.EndsWith("]")){section=line.Substring(1,line.Length-2);continue;}int eq=line.IndexOf('=');if(section.Equals("General",StringComparison.OrdinalIgnoreCase)&&eq>0){string k=line.Substring(0,eq).Trim();if(k=="EnableMultiRbx"||k=="UseExternalMultiRoblox")general[k]=line.Substring(eq+1).Trim();}}
  string enabled,external;Require(general.TryGetValue("EnableMultiRbx",out enabled)&&enabled.Equals("true",StringComparison.OrdinalIgnoreCase)&&(!general.TryGetValue("UseExternalMultiRoblox",out external)||external.Equals("false",StringComparison.OrdinalIgnoreCase)),"PAIR_MULTI_CLIENT_UNAVAILABLE");PairVerifyProtocol();
 }
 static HttpWebResponse PairResponse(HttpWebRequest request){try{return (HttpWebResponse)request.GetResponse();}catch(WebException e){var response=e.Response as HttpWebResponse;if(response!=null)return response;throw new HostError("PAIR_NETWORK_UNAVAILABLE");}}
 static HttpWebRequest PairRequest(string uri,string cookie){var request=(HttpWebRequest)WebRequest.Create(uri);request.AllowAutoRedirect=false;request.Timeout=12000;request.ReadWriteTimeout=12000;request.CookieContainer=null;request.Headers[HttpRequestHeader.Cookie]=".ROBLOSECURITY="+cookie;return request;}
 static string PairBody(HttpWebResponse response,int limit){using(var stream=response.GetResponseStream())using(var reader=new StreamReader(stream)){var buffer=new char[limit+1];int count=0,n;while(count<buffer.Length&&(n=reader.Read(buffer,count,buffer.Length-count))>0)count+=n;Require(count<=limit,"PAIR_RESPONSE_TOO_LARGE");return new string(buffer,0,count);}}
 static bool PairAllowedPrivateRedirect(Uri target,string place,string code){
  if(target==null||!target.IsAbsoluteUri||target.Scheme!="https"||!target.Host.Equals("www.roblox.com",StringComparison.OrdinalIgnoreCase)||target.Port!=443||!String.IsNullOrEmpty(target.UserInfo)||!String.IsNullOrEmpty(target.Fragment)||String.IsNullOrEmpty(code))return false;
  if(!Regex.IsMatch(target.AbsolutePath,@"^/(?:[a-z]{2}(?:-[a-z]{2})?/)?games/"+Regex.Escape(place)+@"(?:/[^/?#]*)?/?$"))return false;
  var query=HttpUtility.ParseQueryString(target.Query);var values=query.GetValues("privateServerLinkCode");return values!=null&&values.Length==1&&query["privateServerLinkCode"]==code;
 }
 static PairPrepared PairPrepare(PairAccount account){
  using(var response=PairResponse(PairRequest("https://users.roblox.com/v1/users/authenticated",account.Cookie))){Require(response.StatusCode==HttpStatusCode.OK,"PAIR_SESSION_INVALID");Require(S(D(J.DeserializeObject(PairBody(response,32768))),"id")==account.Id,"PAIR_ACCOUNT_ID_MISMATCH");}
  Uri target=new Uri(account.PrivateUrl);string link=HttpUtility.ParseQueryString(target.Query)["privateServerLinkCode"],body=null;
  for(int hop=0;hop<5;hop++){using(var response=PairResponse(PairRequest(target.AbsoluteUri,account.Cookie))){int status=(int)response.StatusCode;if(new[]{301,302,303,307,308}.Contains(status)){Uri next=null;Require(hop<4&&Uri.TryCreate(target,response.Headers["Location"],out next)&&PairAllowedPrivateRedirect(next,account.Place,link),"PRIVATE_TARGET_REDIRECT_REJECTED");target=next;continue;}Require(status==200,"PRIVATE_TARGET_DENIED");body=PairBody(response,4194304);break;}}
  var access=Regex.Match(body??"",@"Roblox\.GameLauncher\.joinPrivateGame\(\d+\s*,\s*'([0-9a-fA-F-]{36})'");Guid parsed;Require(access.Success&&Guid.TryParse(access.Groups[1].Value,out parsed),"PRIVATE_TARGET_ACCESS_UNAVAILABLE");string csrf=null,ticket=null;
  for(int attempt=0;attempt<2;attempt++){var req=PairRequest("https://auth.roblox.com/v1/authentication-ticket/",account.Cookie);req.Method="POST";req.Referer="https://www.roblox.com/games/"+account.Place;req.ContentType="application/json";if(csrf!=null)req.Headers["x-csrf-token"]=csrf;var bytes=Encoding.UTF8.GetBytes("{}");req.ContentLength=bytes.Length;using(var stream=req.GetRequestStream())stream.Write(bytes,0,bytes.Length);
   using(var response=PairResponse(req)){Require(String.IsNullOrEmpty(response.Headers["rblx-challenge-id"])&&String.IsNullOrEmpty(response.Headers["rblx-challenge-type"]),"PAIR_AUTHENTICATION_CHALLENGE");if(attempt==0&&response.StatusCode==HttpStatusCode.Forbidden&&!String.IsNullOrEmpty(response.Headers["x-csrf-token"])){csrf=response.Headers["x-csrf-token"];continue;}Require((int)response.StatusCode>=200&&(int)response.StatusCode<300,"PAIR_TICKET_DENIED");ticket=response.Headers["rbx-authentication-ticket"];break;}}
  Require(!String.IsNullOrWhiteSpace(ticket)&&ticket.Length<8192&&!Regex.IsMatch(ticket,@"[\s+""<>]"),"PAIR_TICKET_INVALID");string launcher="https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestPrivateGame&placeId="+account.Place+"&accessCode="+Uri.EscapeDataString(access.Groups[1].Value)+"&linkCode="+Uri.EscapeDataString(link);
  string tracker=DateTime.UtcNow.Ticks.ToString();string protocol="roblox-player:1+launchmode:play+gameinfo:"+ticket+"+launchtime:"+((long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds).ToString()+"+placelauncherurl:"+Uri.EscapeDataString(launcher)+"+browsertrackerid:"+tracker+"+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp";
  return new PairPrepared{Account=account,Ticket=ticket,Protocol=protocol};
 }
 static PairEvidence PairReadEvidence(PairAccount account,DateTime since,PairOwned owned){
  string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Roblox","logs");if(!Directory.Exists(root))return null;
  foreach(string path in Directory.GetFiles(root,"*Player*last.log").OrderByDescending(File.GetLastWriteTimeUtc).Take(40)){
   if(File.GetLastWriteTimeUtc(path)<since.AddSeconds(-3))continue;if(!Regex.IsMatch(Path.GetFileName(path),@"_\d{8}T\d{6}Z_Player_[0-9A-Za-z]+_last\.log$"))continue;var stamp=Regex.Match(Path.GetFileName(path),@"_(\d{8}T\d{6}Z)_Player_");DateTime started;if(!stamp.Success||!DateTime.TryParseExact(stamp.Groups[1].Value,"yyyyMMddTHHmmss'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal|System.Globalization.DateTimeStyles.AdjustToUniversal,out started)||started<since.AddSeconds(-3))continue;
   if(!PairLogOwned(path,owned))continue;
   string text;try{using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){Require(file.Length<=16777216,"PAIR_LOG_TOO_LARGE");using(var reader=new StreamReader(file))text=reader.ReadToEnd();}}catch(IOException){continue;}Require(pairServices.Alive(owned)&&PairLogOwned(path,owned),"PAIR_LOG_OWNERSHIP_UNCONFIRMED");var evidence=PairParseEvidence(text,account.Id,account.Place);if(evidence!=null){evidence.LogName=Path.GetFileName(path);return evidence;}
  }return null;
 }
 static PairEvidence PairParseEvidence(string text,string user,string place){
  var lines=text.Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries);int first=Array.FindLastIndex(lines,l=>l.Contains("[FLog::Output]")&&l.Contains("Joining game"));if(first<0)return null;var marker=Regex.Match(lines[first],@"Joining game\s+'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'\s+place\s+(\d+)\b");if(!marker.Success)return null;Require(marker.Groups[2].Value==place,"PAIR_WRONG_MAP");
  var segment=lines.Skip(first).ToArray();var joins=segment.Where(l=>l.Contains("[FLog::GameJoinLoadTime]")).ToArray();if(joins.Length==0)return null;string join=joins.Last();var uid=Regex.Match(join,@"(?i)\buserid\s*:\s*(\d+)");if(!uid.Success||uid.Groups[1].Value!=user)return null;var p=Regex.Match(join,@"(?i)\bplaceid\s*:\s*(\d+)");Require(p.Success&&p.Groups[1].Value==place,"PAIR_WRONG_MAP");Require(Regex.IsMatch(join,@"(?i)\breferral_page\s*:\s*RequestPrivateGame\b"),"PAIR_NOT_PRIVATE");
  bool ended=segment.Any(l=>Regex.IsMatch(l,@"(?i)\[(?:D?FLog|Log)::(?:NetworkClient|Network)\][^\r\n]*\b(?:disconnect(?:ed|ion)?|connection (?:closed|lost)|lost connection)\b")||Regex.IsMatch(l,@"(?i)\[(?:D?FLog|Log)::[^\]]+\]\s*(?:.*\b(?:Leaving game|Ended play session|Ending play session|Teleporting|Teleport initiated|Teleport requested|Application is exiting|Shutting down)\b)"));
  string current=String.Join("\n",segment);bool connected=!ended&&current.Contains("Entered play session.")&&Regex.IsMatch(current,@"\[(?:D?FLog|Log)::NetworkClient\][^\r\n]*Connection accepted");return new PairEvidence{Place=place,Server=marker.Groups[1].Value.ToLowerInvariant(),Sequence=Fingerprint(lines[first]),Connected=connected};
 }
 [StructLayout(LayoutKind.Sequential)] struct PairRmFileTime{public uint Low,High;}
 [StructLayout(LayoutKind.Sequential)] struct PairRmUniqueProcess{public uint Pid;public PairRmFileTime Started;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct PairRmProcessInfo{public PairRmUniqueProcess Process;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)]public string AppName;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)]public string ServiceName;public uint ApplicationType,Status,SessionId;[MarshalAs(UnmanagedType.Bool)]public bool Restartable;}
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session,int flags,StringBuilder key);
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session,uint files,string[] names,uint applications,PairRmUniqueProcess[] processes,uint services,string[] serviceNames);
 [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session,out uint needed,ref uint count,[In,Out]PairRmProcessInfo[] processes,ref uint rebootReasons);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
 static bool PairLogOwned(string path,PairOwned owned){
  uint session=0;bool started=false;try{Require(RmStartSession(out session,0,new StringBuilder(33))==0,"PAIR_LOG_OWNERSHIP_UNAVAILABLE");started=true;Require(RmRegisterResources(session,1,new[]{path},0,null,0,null)==0,"PAIR_LOG_OWNERSHIP_UNAVAILABLE");uint needed=0,count=0,reasons=0;int result=RmGetList(session,out needed,ref count,null,ref reasons);if(result==0&&needed==0)return false;Require(result==234&&needed>0&&needed<=1024,"PAIR_LOG_OWNERSHIP_UNAVAILABLE");
   for(int retry=0;retry<3;retry++){var entries=new PairRmProcessInfo[needed];count=needed;result=RmGetList(session,out needed,ref count,entries,ref reasons);if(result==234){Require(needed>0&&needed<=1024,"PAIR_LOG_OWNERSHIP_UNAVAILABLE");continue;}Require(result==0&&count<=entries.Length,"PAIR_LOG_OWNERSHIP_UNAVAILABLE");for(int i=0;i<count;i++){var p=entries[i].Process;long fileTime=((long)p.Started.High<<32)|p.Started.Low;if(p.Pid==(uint)owned.Pid&&DateTime.FromFileTimeUtc(fileTime).Ticks==owned.StartTicks)return true;}return false;}
   throw new HostError("PAIR_LOG_OWNERSHIP_UNAVAILABLE");
  }catch(HostError){throw;}catch{throw new HostError("PAIR_LOG_OWNERSHIP_UNAVAILABLE");}finally{if(started)RmEndSession(session);}
 }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct PairTrustFile{public uint Size;public string Path;public IntPtr FileHandle,KnownSubject;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct PairTrustData{public uint Size;public IntPtr Policy,Sip;public uint UI,Revocation,Choice;public IntPtr File;public uint StateAction;public IntPtr State,Url;public uint Flags,Context;}
 [DllImport("wintrust.dll",ExactSpelling=true,CharSet=CharSet.Unicode)] static extern int WinVerifyTrust(IntPtr window,[MarshalAs(UnmanagedType.LPStruct)]Guid action,ref PairTrustData data);
 static void PairVerifyProtocol(){
  string command;using(var key=Registry.ClassesRoot.OpenSubKey(@"roblox-player\shell\open\command")){command=key==null?null:Convert.ToString(key.GetValue(null));}Require(!String.IsNullOrEmpty(command),"ROBLOX_PROTOCOL_UNAVAILABLE");var match=Regex.Match(command,@"^\s*""([^""]+\.exe)""\s+""?%1""?\s*$",RegexOptions.IgnoreCase);Require(match.Success,"ROBLOX_PROTOCOL_UNTRUSTED");string exe=Path.GetFullPath(match.Groups[1].Value),name=Path.GetFileName(exe);Require(new[]{"RobloxPlayerInstaller.exe","RobloxPlayerLauncher.exe","RobloxPlayerBeta.exe"}.Contains(name,StringComparer.OrdinalIgnoreCase)&&File.Exists(exe),"ROBLOX_PROTOCOL_UNTRUSTED");
  string local=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Roblox","Versions")+Path.DirectorySeparatorChar;string program=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Roblox","Versions")+Path.DirectorySeparatorChar;Require(exe.StartsWith(local,StringComparison.OrdinalIgnoreCase)||exe.StartsWith(program,StringComparison.OrdinalIgnoreCase),"ROBLOX_PROTOCOL_UNTRUSTED");
  var file=new PairTrustFile{Size=(uint)Marshal.SizeOf(typeof(PairTrustFile)),Path=exe};IntPtr ptr=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PairTrustFile)));try{Marshal.StructureToPtr(file,ptr,false);var data=new PairTrustData{Size=(uint)Marshal.SizeOf(typeof(PairTrustData)),UI=2,Choice=1,File=ptr,Flags=0x1000};Require(WinVerifyTrust(new IntPtr(-1),new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE"),ref data)==0,"ROBLOX_PROTOCOL_UNTRUSTED");var certificate=new System.Security.Cryptography.X509Certificates.X509Certificate2(System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(exe));Require(certificate.GetNameInfo(System.Security.Cryptography.X509Certificates.X509NameType.SimpleName,false).Equals("Roblox Corporation",StringComparison.OrdinalIgnoreCase),"ROBLOX_PROTOCOL_UNTRUSTED");}finally{Marshal.DestroyStructure(ptr,typeof(PairTrustFile));Marshal.FreeHGlobal(ptr);}
 }
}
