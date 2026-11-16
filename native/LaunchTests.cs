using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;

internal static partial class Host {
 sealed class PairFixture {
  public DateTime Clock=new DateTime(2026,1,1,0,0,0,DateTimeKind.Utc);
  public int Starts,Closes,Discovers;public bool CancelFirst,CancelInEvidence,NeverDiscover,LateDiscover,DifferentServer,OperatorDisconnectAtBarrier,OperatorTeleportAtBarrier;
  public readonly Dictionary<int,bool> Live=new Dictionary<int,bool>();
  public Dictionary<string,object> Job;
  public object[] Accounts(){return new object[]{Obj("UserID","11","SecurityToken","fake-op-memory-only","Fields",Obj("SavedPlaceId","999")),Obj("UserID","22","SecurityToken","fake-customer-memory-only"),Obj("UserID","33","Fields",Obj("SavedPlaceId","100","SavedJobId","https://www.roblox.com/games/100?privateServerLinkCode=fixture_only"))};}
  public PairServices Services(){return new PairServices{
   Accounts=Accounts,Preflight=()=>{},Now=()=>Clock,Wait=ms=>{Clock=Clock.AddMilliseconds(ms);},Persist=()=>{},JoinSeconds=2,DiscoverySeconds=4,CloseSeconds=2,
   Prepare=a=>new PairPrepared{Account=a,Ticket="fixture-ticket-"+a.Id,Protocol="fixture-protocol-memory-only"},
   Start=p=>{Starts++;Live[Starts]=true;if(CancelFirst&&Starts==1){lock(Gate){Require(!CloseOwnedPair(Job),"PAIR_TEST_CANCEL_WAIT");}}},
   Discover=(ticket,since)=>{Discovers++;if(NeverDiscover||(LateDiscover&&Discovers<3))return new List<PairOwned>();int pid=ticket.EndsWith("11")?1:2;return Live.ContainsKey(pid)?new List<PairOwned>{new PairOwned{Pid=pid,StartTicks=pid+100}}:new List<PairOwned>();},
   Alive=p=>Live.ContainsKey(p.Pid)&&Live[p.Pid],Close=p=>{Closes++;Live[p.Pid]=false;},
   Evidence=(a,since,owned)=>{Require(owned.Role==(a.Id=="11"?"operator":"customer"),"PAIR_TEST_EVIDENCE_OWNED_PROCESS");if(CancelInEvidence&&a.Id=="11"){lock(Gate){Require(!CloseOwnedPair(Job),"PAIR_TEST_CANCEL_WAIT");}}return new PairEvidence{Connected=!(OperatorDisconnectAtBarrier&&a.Id=="11"&&Starts==2),Place=a.Place,Sequence=OperatorTeleportAtBarrier&&a.Id=="11"&&Starts==2?"different-current-join":"fixture-current-join-"+a.Id,Server=DifferentServer&&a.Id=="22"?"22222222-2222-2222-2222-222222222222":"11111111-1111-1111-1111-111111111111"};}
  };}
  public void Begin(){Job=Obj("jobId","fixture-"+Guid.NewGuid().ToString("N"),"generation",1,"order",Obj("placeId","100","privateServerSourceUserId","33"),"operator",Obj("userId","11","state","ready"),"customer",Obj("userId","22","state","ready"),"protectedOperatorUserIds",new object[]{"11","33"});ledger=Obj("revision",0,"current",Job,"handled",new object[0],"commands",new Dictionary<string,object>());pairServices=Services();lock(Gate){LaunchPair(Obj("jobId",Job["jobId"],"generation",1));}}
  public PairRun Run(){return pairRuns[PairKey(S(Job,"jobId"),"1")];}
  public void Finish(){Require(Run().Done.WaitOne(5000),"PAIR_TEST_WORKER_TIMEOUT");lock(Gate){Require(!Run().Active,"PAIR_TEST_WORKER_ACTIVE");}}
  public void Close(){lock(Gate){Require(!CloseOwnedPair(Job),"PAIR_TEST_CLOSE_PENDING");}Finish();lock(Gate){Require(CloseOwnedPair(Job),"PAIR_TEST_CLOSE_COMPLETE");}}
 }
 static void PairExpect(string code,Action action){try{action();throw new Exception("Expected "+code);}catch(HostError e){Require(e.Code==code,"PAIR_TEST_ERROR_CODE");}}
 static void LaunchSelfTests(){
  var oldLedger=ledger;var oldServices=pairServices;var oldRuns=pairRuns.ToArray();try{
   pairRuns.Clear();var f=new PairFixture();string target=PairPrivateTarget(f.Accounts(),"33","100");Require(target.Contains("/games/100?"),"PAIR_TEST_TARGET");PairExpect("PRIVATE_TARGET_MAP_MISMATCH",()=>PairPrivateTarget(f.Accounts(),"33","101"));PairExpect("PRIVATE_TARGET_MISSING",()=>PairPrivateTarget(f.Accounts(),"44","100"));
   foreach(string path in new[]{"/games/100","/th/games/100","/en-us/games/100/title"})Require(PairAllowedPrivateRedirect(new Uri("https://www.roblox.com"+path+"?privateServerLinkCode=fixture_only"),"100","fixture_only"),"PAIR_TEST_LOCALE_REDIRECT");
   foreach(string url in new[]{"https://www.roblox.com/th/games/101?privateServerLinkCode=fixture_only","https://example.com/th/games/100?privateServerLinkCode=fixture_only","https://www.roblox.com/th/account/games/100?privateServerLinkCode=fixture_only","https://www.roblox.com/en_us/games/100?privateServerLinkCode=fixture_only","https://www.roblox.com/th/games/100?privateServerLinkCode=changed","https://www.roblox.com:444/th/games/100?privateServerLinkCode=fixture_only"})Require(!PairAllowedPrivateRedirect(new Uri(url),"100","fixture_only"),"PAIR_TEST_REDIRECT_SCOPE");
   var localeStored=f.Accounts();D(D(localeStored[2])["Fields"])["SavedJobId"]="https://www.roblox.com/th/games/100?privateServerLinkCode=fixture_only";PairExpect("PRIVATE_TARGET_INVALID",()=>PairPrivateTarget(localeStored,"33","100"));
   Require(PairAccountFrom(f.Accounts(),"11","100",target).Place=="100","PAIR_TEST_POOL_MAP_OVERRIDE");PairExpect("PAIR_ACCOUNT_MISSING",()=>PairAccountFrom(f.Accounts(),"88","100",target));
   Require(PairTicketInCommand("player.exe --app -t \"fixture-ticket\" -b 123","fixture-ticket"),"PAIR_TEST_TICKET_OWNERSHIP");Require(PairTicketInCommand("player.exe roblox-player:1+launchmode:play+gameinfo:fixture-ticket+launchtime:1","fixture-ticket"),"PAIR_TEST_PROTOCOL_OWNERSHIP");Require(!PairTicketInCommand("player.exe --app -t fixture-ticket-extra -b 123","fixture-ticket"),"PAIR_TEST_TICKET_BOUNDARY");Require(!PairTicketInCommand("player.exe unrelated=fixture-ticket","fixture-ticket"),"PAIR_TEST_TICKET_FIELD");
   string log="[FLog::Output] Joining game '11111111-1111-1111-1111-111111111111' place 100 at [redacted]\n[DFLog::NetworkClient] Connection accepted\nEntered play session.\n[FLog::GameJoinLoadTime] userid:22, placeid:100, referral_page:RequestPrivateGame";
   var e=PairParseEvidence(log,"22","100");Require(e!=null&&e.Connected&&e.Server=="11111111-1111-1111-1111-111111111111","PAIR_TEST_LOG_EVIDENCE");Require(PairParseEvidence(log,"11","100")==null,"PAIR_TEST_LOG_IDENTITY");PairExpect("PAIR_WRONG_MAP",()=>PairParseEvidence(log,"22","101"));PairExpect("PAIR_NOT_PRIVATE",()=>PairParseEvidence(log.Replace("RequestPrivateGame","RequestGame"),"22","100"));
   string next="\n[FLog::Output] Joining game '22222222-2222-2222-2222-222222222222' place 100 at [redacted]";Require(PairParseEvidence(log+next,"22","100")==null,"PAIR_TEST_NO_OLD_IDENTITY");var mixed=PairParseEvidence(log+next+"\n[FLog::GameJoinLoadTime] userid:22, placeid:100, referral_page:RequestPrivateGame","22","100");Require(mixed!=null&&!mixed.Connected,"PAIR_TEST_NO_OLD_CONNECTION");Require(!PairParseEvidence(log+"\n[DFLog::NetworkClient] Connection lost","22","100").Connected,"PAIR_TEST_DISCONNECTED_SEQUENCE");Require(!PairParseEvidence(log+"\n[FLog::TeleportService] Teleporting to a new game","22","100").Connected,"PAIR_TEST_TELEPORT_SEQUENCE");
   f.Begin();f.Finish();Require(f.Starts==2&&S(D(f.Job["launchPair"]),"state")=="connected"&&f.Live.Values.All(x=>x),"PAIR_TEST_TWO_LIVE");lock(Gate){LaunchPair(Obj("jobId",f.Job["jobId"],"generation",1));}Require(f.Starts==2,"PAIR_TEST_IDEMPOTENT");Require(!J.Serialize(f.Job).Contains("fixture-ticket")&&!J.Serialize(f.Job).Contains("memory-only")&&!J.Serialize(f.Job).Contains("privateServerLinkCode"),"PAIR_TEST_NO_SECRETS");f.Close();Require(f.Closes==2&&!f.Live.Values.Any(x=>x),"PAIR_TEST_OWNED_CLOSE");
   f=new PairFixture{CancelInEvidence=true};f.Begin();f.Finish();Require(f.Starts==1&&f.Closes==1,"PAIR_TEST_CANCEL_BEFORE_SECOND");lock(Gate){Require(CloseOwnedPair(f.Job),"PAIR_TEST_CANCEL_CLEANED");LaunchPair(Obj("jobId",f.Job["jobId"],"generation",1));}Require(f.Starts==1,"PAIR_TEST_CANCEL_NO_RETRY");
   f=new PairFixture{CancelFirst=true,LateDiscover=true};f.Begin();f.Finish();Require(f.Starts==1&&f.Closes==1&&f.Discovers>=3,"PAIR_TEST_LATE_OWNERSHIP_CLEANUP");lock(Gate){Require(CloseOwnedPair(f.Job),"PAIR_TEST_LATE_CLEANED");}
   f=new PairFixture{NeverDiscover=true};f.Begin();f.Finish();Require(f.Starts==1&&f.Run().Uncertain,"PAIR_TEST_UNKNOWN_BLOCKED");lock(Gate){Require(!CloseOwnedPair(f.Job),"PAIR_TEST_UNKNOWN_CLOSE_PENDING");}f.Finish();lock(Gate){Require(!CloseOwnedPair(f.Job),"PAIR_TEST_UNKNOWN_STAYS_PENDING");LaunchPair(Obj("jobId",f.Job["jobId"],"generation",1));}Require(f.Starts==1,"PAIR_TEST_UNKNOWN_NO_DUPLICATE");
   f=new PairFixture{DifferentServer=true};f.Begin();f.Finish();Require(f.Starts==2&&S(D(f.Job["launchPair"]),"code")=="PAIR_DIFFERENT_SERVER","PAIR_TEST_SAME_SERVER_REQUIRED");f.Close();
   f=new PairFixture{OperatorDisconnectAtBarrier=true};f.Begin();f.Finish();Require(f.Starts==2&&S(D(f.Job["launchPair"]),"code")=="PAIR_CONNECTION_LOST","PAIR_TEST_REFRESH_OPERATOR_CONNECTION");f.Close();
   f=new PairFixture{OperatorTeleportAtBarrier=true};f.Begin();f.Finish();Require(f.Starts==2&&S(D(f.Job["launchPair"]),"code")=="PAIR_CLIENT_SESSION_CHANGED","PAIR_TEST_REFRESH_OPERATOR_SEQUENCE");f.Close();
   f=new PairFixture();f.Begin();f.Finish();pairRuns.Remove(PairKey(S(f.Job,"jobId"),"1"));lock(Gate){MaybeSchedulePair(f.Job);}Require(f.Starts==2,"PAIR_TEST_RECOVERY_NO_LAUNCH");f.Close();
  }finally{pairServices=oldServices;ledger=oldLedger;pairRuns.Clear();foreach(var item in oldRuns)pairRuns.Add(item.Key,item.Value);}
 }
 // Reachable only from the explicit CLI switch integrated by the host owner.
 // Both roles here are the user's own preexisting RAM accounts; no import/login.
 static int LiveOwnedPairTest(string baseDir){
  string reportDir=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"bewqueue-live-pair-"+NewId());System.IO.Directory.CreateDirectory(reportDir);
  string oldRam=ramPath,oldExe=ramExePath,oldLedgerPath=ledgerPath;var oldLedger=ledger;var oldServices=pairServices;var oldOutput=eventOutput;
  Dictionary<string,object> job=null;PairRun run=null;Dictionary<string,object> observation=null;bool connected=false,closed=false,simultaneous=false;string code=null;int remaining=0;
  try{
   var cfg=D(J.DeserializeObject(System.IO.File.ReadAllText(System.IO.Path.Combine(baseDir,"config.json"))));string ramDirectory=Environment.ExpandEnvironmentVariables(S(cfg,"ramDirectory"));Require(System.IO.Path.IsPathRooted(ramDirectory),"CONFIG_INVALID");ramPath=System.IO.Path.Combine(ramDirectory,"AccountData.json");ramExePath=System.IO.Path.GetFullPath(System.IO.Path.Combine(ramDirectory,"Bewpakorn RAM.exe"));
   Require(ProcessCountForLiveTest()==0,"PAIR_UNOWNED_CLIENT_PRESENT");pairServices=new PairServices();eventOutput=null;ledgerPath=System.IO.Path.Combine(reportDir,"ledger.json");
   job=Obj("jobId","live-owned-"+NewId(),"generation",1,"order",Obj("placeId","132929771812494","privateServerSourceUserId","7219088985"),"operator",Obj("userId","7219078061","state","ready"),"customer",Obj("userId","7219088985","state","ready"),"protectedOperatorUserIds",new object[]{"7219078061"});
   ledger=Obj("revision",0,"current",job,"handled",new object[0],"commands",new Dictionary<string,object>());lock(Gate){LaunchPair(Obj("jobId",job["jobId"],"generation",1));run=pairRuns[PairKey(S(job,"jobId"),"1")];}
   Console.WriteLine("PAIR_LIVE_STARTED");Require(run.Done.WaitOne(240000),"PAIR_LIVE_TIMEOUT");lock(Gate){connected=S(D(job["launchPair"]),"state")=="connected";code=S(D(job["launchPair"]),"code");simultaneous=run.Owned.Count==2&&run.Owned.Select(x=>x.Pid).Distinct().Count()==2&&run.Owned.All(pairServices.Alive);}
   if(connected&&simultaneous){Console.WriteLine("PAIR_LIVE_CONNECTED");for(int i=0;i<15;i++){Thread.Sleep(1000);if(!run.Owned.All(pairServices.Alive)){observation=Obj("code","PAIR_CLIENT_EXITED","second",i);break;}foreach(var a in run.Attempts){var owned=run.Owned.Single(p=>p.Role==a.Role);var evidence=pairServices.Evidence(a.Prepared.Account,a.Since,owned);if(evidence==null||!evidence.Connected||evidence.Sequence!=a.Sequence){observation=Obj("code","PAIR_CONNECTION_LOST","second",i,"role",a.Role,"evidenceMissing",evidence==null,"connectedFlag",evidence!=null&&evidence.Connected,"sequenceMatch",evidence!=null&&evidence.Sequence==a.Sequence,"log",evidence==null?"":evidence.LogName,"server",evidence==null?"":evidence.Server);break;}}if(observation!=null)break;}if(observation!=null){connected=false;code=S(observation,"code");}}
  }catch(Exception e){code=ErrorCode(e);connected=false;}
  finally{
   if(job!=null&&run!=null){var end=DateTime.UtcNow.AddSeconds(55);do{lock(Gate){closed=CloseOwnedPair(job);}if(closed)break;Thread.Sleep(500);}while(DateTime.UtcNow<end);}
   try{remaining=ProcessCountForLiveTest();}catch{remaining=-1;}
   var report=Obj("mode","explicit_owned_pair_test","observationFailure",observation,"connected",connected,"distinctSimultaneousProcesses",simultaneous,"sameLiveServerVerified",connected&&simultaneous,"renderedGameplayVerified",false,"ownedClientsClosed",closed,"remainingNativePlayers",remaining,"code",code??"","roles",job==null?null:Obj("operator",D(job["operator"]),"customer",D(job["customer"])));
   string reportPath=System.IO.Path.Combine(reportDir,"result.json");System.IO.File.WriteAllText(reportPath,J.Serialize(report),new System.Text.UTF8Encoding(false));Console.WriteLine(J.Serialize(Obj("reportPath",reportPath,"connected",connected,"ownedClientsClosed",closed,"code",code??"")));
   // Restore shared process state only after this worker cannot still reference it.
   if(run==null||!run.Active){pairServices=oldServices;ledger=oldLedger;ledgerPath=oldLedgerPath;ramPath=oldRam;ramExePath=oldExe;eventOutput=oldOutput;}
  }
  return connected&&simultaneous&&closed?0:1;
 }
 static int ProcessCountForLiveTest(){var players=System.Diagnostics.Process.GetProcessesByName("RobloxPlayerBeta");try{return players.Length;}finally{foreach(var p in players)p.Dispose();}}
}
