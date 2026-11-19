using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web;
using Microsoft.Win32;

internal static partial class Host {
 sealed class CustomerLaunchServices {
  public Func<object[]> Accounts = () => readSavedAccounts();
  public Action VerifyProtocol = VerifyRobloxProtocol;
  public Func<string, string, string, string> ResolvePrivateAccess = FetchPrivateAccessCode;
  public Func<string, string, string> FetchTicket = FetchRobloxAuthTicket;
  public Action<string> StartProtocol = uri => { using (var p = Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true })) { } };
  public Func<DateTime> Now = () => DateTime.UtcNow;
 }

 static CustomerLaunchServices customerLaunchServices = new CustomerLaunchServices();
 static string activeCustomerLaunchKey;

 static string NormalizeLaunchMode(string mode) {
  if (String.IsNullOrEmpty(mode)) return "auto";
  string lower = mode.Trim().ToLowerInvariant();
  Require(lower == "auto" || lower == "private" || lower == "public", "INVALID_REQUEST");
  return lower;
 }

 static bool CurrentReadyCustomer(string jobId, string gen, string userId) {
  var job = D(ledger["current"]);
  if (job == null || S(job, "jobId") != jobId || S(job, "generation") != gen) return false;
  var role = D(job.ContainsKey("customer") ? job["customer"] : null);
  return role != null && S(role, "state") == "ready" && S(role, "userId") == userId;
 }

 static string ExtractValidPrivateServerUrl(Dictionary<string, object> account, string placeId) {
  if (account == null) return null;
  var fields = D(account.ContainsKey("Fields") ? account["Fields"] : null);
  if (fields == null || S(fields, "SavedPlaceId") != placeId) return null;
  string raw = S(fields, "SavedJobId");
  if (String.IsNullOrWhiteSpace(raw)) return null;
  Uri u;
  if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out u)) return null;
  if (u.Scheme != "https" || !u.Host.Equals("www.roblox.com", StringComparison.OrdinalIgnoreCase) || u.Port != 443 || !String.IsNullOrEmpty(u.UserInfo) || !String.IsNullOrEmpty(u.Fragment)) return null;
  if (!Regex.IsMatch(u.AbsolutePath, @"^/(?:[a-z]{2}(?:-[a-z]{2})?/)?games/" + Regex.Escape(placeId) + @"(?:/[^/?#]*)?/?$", RegexOptions.IgnoreCase)) return null;
  var q = HttpUtility.ParseQueryString(u.Query);
  var values = q.GetValues("privateServerLinkCode");
  if (values == null || values.Length != 1) return null;
  string code = values[0];
  if (String.IsNullOrWhiteSpace(code) || code.Length > 256 || !Regex.IsMatch(code, @"^[A-Za-z0-9_-]+$")) return null;
  return "https://www.roblox.com/games/" + placeId + "?privateServerLinkCode=" + Uri.EscapeDataString(code);
 }

 static string FindPrivateServerUrl(object[] accounts, Dictionary<string, object> job, string placeId, string excludeCustomerId) {
  if (accounts == null || accounts.Length == 0 || job == null) return null;
  var order = D(job.ContainsKey("order") ? job["order"] : null);
  var op = D(job.ContainsKey("operator") ? job["operator"] : null);
  var priorityIds = new List<string>();
  Action<string> addId = id => {
   if (!String.IsNullOrEmpty(id) && id != excludeCustomerId && !priorityIds.Contains(id)) priorityIds.Add(id);
  };
  addId(S(order, "privateServerSourceUserId"));
  addId(S(op, "userId"));
  if (order != null) {
   try { foreach (var id in ReadOperatorPool(order)) addId(id); } catch { }
  }
  if (job.ContainsKey("protectedOperatorUserIds")) {
   foreach (var item in A(job["protectedOperatorUserIds"])) addId(Convert.ToString(item));
  }
  foreach (var id in priorityIds) {
   var acc = FindAccount(accounts, id);
   string url = ExtractValidPrivateServerUrl(acc, placeId);
   if (url != null) return url;
  }
  foreach (var item in accounts) {
   var acc = D(item);
   if (acc == null || S(acc, "UserID") == excludeCustomerId) continue;
   string url = ExtractValidPrivateServerUrl(acc, placeId);
   if (url != null) return url;
  }
  return null;
 }

 static Dictionary<string, object> LaunchCustomerGameCommand(Dictionary<string, object> p) {
  Require(p != null, "INVALID_REQUEST");
  string mode = NormalizeLaunchMode(S(p, "mode"));
  var job = D(ledger["current"]);
  Require(job != null && S(job, "jobId") == S(p, "jobId") && S(job, "generation") == S(p, "generation"), "STALE_JOB");
  var role = D(job["customer"]);
  Require(S(role, "state") == "ready" && ValidUserId(S(role, "userId")), "CUSTOMER_SESSION_NOT_READY");
  string userId = S(role, "userId");
  var account = FindAccount(customerLaunchServices.Accounts(), userId);
  Require(account != null && S(account, "UserID") == userId, "RAM_ACCOUNT_NOT_FOUND");
  string cookie = S(account, "SecurityToken");
  Require(!String.IsNullOrWhiteSpace(cookie), "CUSTOMER_SESSION_INVALID");
  StartCustomerGameLaunch(S(job, "jobId"), S(job, "generation"), userId, cookie, mode);
  return Snapshot();
 }

 static void StartCustomerGameLaunch(string jobId, string gen, string userId, string cookie, string mode) {
  var job = D(ledger["current"]);
  if (job == null || S(job, "jobId") != jobId || S(job, "generation") != gen) return;
  var order = D(job["order"]);
  string placeId = S(order, "placeId");
  var role = D(job["customer"]);
  if (!ValidUserId(placeId)) {
   role["game"] = Obj("state", "failed", "placeId", placeId, "mode", mode, "code", "GAME_PLACE_INVALID");
   Bump(); Save();
   return;
  }
  string key = jobId + ":" + gen;
  if (activeCustomerLaunchKey == key) return;
  activeCustomerLaunchKey = key;
  role["game"] = Obj("state", "launching", "placeId", placeId, "mode", mode);
  Bump(); Save();
  var jobCopy = D(J.DeserializeObject(J.Serialize(job)));
  string cookieCopy = cookie;
  if (selfTesting) {
   LaunchCustomerGameWorker(jobId, gen, userId, cookieCopy, placeId, mode, jobCopy);
   return;
  }
  var thread = new Thread(() => LaunchCustomerGameWorker(jobId, gen, userId, cookieCopy, placeId, mode, jobCopy));
  thread.IsBackground = true;
  thread.Name = "BewQueue customer launcher";
  thread.Start();
 }

 static void LaunchCustomerGameWorker(string jobId, string gen, string userId, string cookie, string placeId, string requestedMode, Dictionary<string, object> jobSnapshot) {
  string key = jobId + ":" + gen;
  string activeMode = requestedMode;
  string privateUrl = null, accessCode = null, linkCode = null, ticket = null, protocol = null;
  try {
   customerLaunchServices.VerifyProtocol();
   if (requestedMode != "public") {
    var accounts = customerLaunchServices.Accounts();
    privateUrl = FindPrivateServerUrl(accounts, jobSnapshot, placeId, userId);
   }
   string launcherUrl;
   string tracker = customerLaunchServices.Now().Ticks.ToString();
   if (privateUrl != null) {
    activeMode = "private";
    linkCode = HttpUtility.ParseQueryString(new Uri(privateUrl).Query)["privateServerLinkCode"];
    accessCode = customerLaunchServices.ResolvePrivateAccess(cookie, placeId, privateUrl);
    launcherUrl = "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestPrivateGame&placeId=" + placeId + "&accessCode=" + Uri.EscapeDataString(accessCode) + "&linkCode=" + Uri.EscapeDataString(linkCode);
   } else if (requestedMode == "private") {
    activeMode = "private";
    throw new HostError("PRIVATE_TARGET_MISSING");
   } else {
    activeMode = "public";
    launcherUrl = "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId=" + tracker + "&placeId=" + placeId + "&isPlayTogetherGame=false";
   }
   ticket = customerLaunchServices.FetchTicket(cookie, placeId);
   Require(!String.IsNullOrWhiteSpace(ticket) && ticket.Length < 8192 && !Regex.IsMatch(ticket, @"[\s+""<>]"), "GAME_LAUNCH_TICKET_DENIED");
   string launchTime = ((long)(customerLaunchServices.Now() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds).ToString();
   protocol = "roblox-player:1+launchmode:play+gameinfo:" + ticket + "+launchtime:" + launchTime + "+placelauncherurl:" + Uri.EscapeDataString(launcherUrl) + "+browsertrackerid:" + tracker + "+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp";
   lock (Gate) {
    if (!CurrentReadyCustomer(jobId, gen, userId)) return;
    customerLaunchServices.StartProtocol(protocol);
    var role = D(D(ledger["current"])["customer"]);
    role["game"] = Obj("state", "launched", "placeId", placeId, "mode", activeMode, "launchedAt", Now());
    Bump(); Save();
   }
  } catch (HostError e) {
   lock (Gate) {
    if (!CurrentReadyCustomer(jobId, gen, userId)) return;
    var role = D(D(ledger["current"])["customer"]);
    role["game"] = Obj("state", "failed", "placeId", placeId, "mode", activeMode, "code", e.Code);
    Bump(); Save();
   }
  } catch {
   lock (Gate) {
    if (!CurrentReadyCustomer(jobId, gen, userId)) return;
    var role = D(D(ledger["current"])["customer"]);
    role["game"] = Obj("state", "failed", "placeId", placeId, "mode", activeMode, "code", "GAME_LAUNCH_UNAVAILABLE");
    Bump(); Save();
   }
  } finally {
   cookie = null; privateUrl = null; accessCode = null; linkCode = null; ticket = null; protocol = null;
   lock (Gate) { if (activeCustomerLaunchKey == key) activeCustomerLaunchKey = null; }
  }
 }

 static HttpWebRequest LaunchHttpRequest(string uri, string cookie) {
  var request = (HttpWebRequest)WebRequest.Create(uri);
  request.AllowAutoRedirect = false;
  request.Timeout = 12000;
  request.ReadWriteTimeout = 12000;
  request.CookieContainer = null;
  request.Headers[HttpRequestHeader.Cookie] = ".ROBLOSECURITY=" + cookie;
  return request;
 }

 static HttpWebResponse LaunchHttpResponse(HttpWebRequest request) {
  try { return (HttpWebResponse)request.GetResponse(); }
  catch (WebException e) {
   var response = e.Response as HttpWebResponse;
   if (response != null) return response;
   throw new HostError("GAME_LAUNCH_NETWORK_UNAVAILABLE");
  }
 }

 static string LaunchReadBody(HttpWebResponse response, int limit) {
  using (var stream = response.GetResponseStream())
  using (var reader = new StreamReader(stream)) {
   var buffer = new char[limit + 1];
   int count = 0, n;
   while (count < buffer.Length && (n = reader.Read(buffer, count, buffer.Length - count)) > 0) count += n;
   Require(count <= limit, "GAME_LAUNCH_UNAVAILABLE");
   return new string(buffer, 0, count);
  }
 }

 static bool AllowedPrivateServerRedirect(Uri target, string placeId, string code) {
  if (target == null || !target.IsAbsoluteUri || target.Scheme != "https" || !target.Host.Equals("www.roblox.com", StringComparison.OrdinalIgnoreCase) || target.Port != 443 || !String.IsNullOrEmpty(target.UserInfo) || !String.IsNullOrEmpty(target.Fragment) || String.IsNullOrEmpty(code)) return false;
  if (!Regex.IsMatch(target.AbsolutePath, @"^/(?:[a-z]{2}(?:-[a-z]{2})?/)?games/" + Regex.Escape(placeId) + @"(?:/[^/?#]*)?/?$", RegexOptions.IgnoreCase)) return false;
  var query = HttpUtility.ParseQueryString(target.Query);
  var values = query.GetValues("privateServerLinkCode");
  return values != null && values.Length == 1 && query["privateServerLinkCode"] == code;
 }

 static string FetchPrivateAccessCode(string cookie, string placeId, string privateUrl) {
  Uri target = new Uri(privateUrl);
  string linkCode = HttpUtility.ParseQueryString(target.Query)["privateServerLinkCode"];
  string body = null;
  for (int hop = 0; hop < 5; hop++) {
   using (var response = LaunchHttpResponse(LaunchHttpRequest(target.AbsoluteUri, cookie))) {
    int status = (int)response.StatusCode;
    if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
     Uri next = null;
     Require(hop < 4 && Uri.TryCreate(target, response.Headers["Location"], out next) && AllowedPrivateServerRedirect(next, placeId, linkCode), "PRIVATE_TARGET_REDIRECT_REJECTED");
     target = next;
     continue;
    }
    Require(status == 200, "PRIVATE_TARGET_DENIED");
    body = LaunchReadBody(response, 4194304);
    break;
   }
  }
  var access = Regex.Match(body ?? "", @"Roblox\.GameLauncher\.joinPrivateGame\(\s*\d+\s*,\s*['""]([0-9a-fA-F-]{36})['""]");
  Guid parsed = Guid.Empty;
  Require(access.Success && Guid.TryParse(access.Groups[1].Value, out parsed), "PRIVATE_TARGET_ACCESS_UNAVAILABLE");
  return parsed.ToString();
 }

 static string FetchRobloxAuthTicket(string cookie, string placeId) {
  string csrf = null, ticket = null;
  for (int attempt = 0; attempt < 2; attempt++) {
   var req = LaunchHttpRequest("https://auth.roblox.com/v1/authentication-ticket/", cookie);
   req.Method = "POST";
   req.Referer = "https://www.roblox.com/games/" + placeId;
   req.ContentType = "application/json";
   if (csrf != null) req.Headers["x-csrf-token"] = csrf;
   var bytes = Encoding.UTF8.GetBytes("{}");
   req.ContentLength = bytes.Length;
   using (var stream = req.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
   using (var response = LaunchHttpResponse(req)) {
    Require(String.IsNullOrEmpty(response.Headers["rblx-challenge-id"]) && String.IsNullOrEmpty(response.Headers["rblx-challenge-type"]), "GAME_LAUNCH_CHALLENGE");
    if (attempt == 0 && response.StatusCode == HttpStatusCode.Forbidden && !String.IsNullOrEmpty(response.Headers["x-csrf-token"])) {
     csrf = response.Headers["x-csrf-token"];
     continue;
    }
    Require((int)response.StatusCode >= 200 && (int)response.StatusCode < 300, "GAME_LAUNCH_TICKET_DENIED");
    ticket = response.Headers["rbx-authentication-ticket"];
    break;
   }
  }
  Require(!String.IsNullOrWhiteSpace(ticket) && ticket.Length < 8192 && !Regex.IsMatch(ticket, @"[\s+""<>]"), "GAME_LAUNCH_TICKET_DENIED");
  return ticket;
 }

 [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct LaunchTrustFile { public uint Size; public string Path; public IntPtr FileHandle, KnownSubject; }
 [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct LaunchTrustData { public uint Size; public IntPtr Policy, Sip; public uint UI, Revocation, Choice; public IntPtr File; public uint StateAction; public IntPtr State, Url; public uint Flags, Context; }
 [DllImport("wintrust.dll", ExactSpelling = true, CharSet = CharSet.Unicode)] static extern int WinVerifyTrust(IntPtr window, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref LaunchTrustData data);

 static void VerifyRobloxProtocol() {
  string command;
  using (var key = Registry.ClassesRoot.OpenSubKey(@"roblox-player\shell\open\command")) {
   command = key == null ? null : Convert.ToString(key.GetValue(null));
  }
  Require(!String.IsNullOrEmpty(command), "ROBLOX_PROTOCOL_UNAVAILABLE");
  var match = Regex.Match(command, @"^\s*""([^""]+\.exe)""\s+""?%1""?\s*$", RegexOptions.IgnoreCase);
  Require(match.Success, "ROBLOX_PROTOCOL_UNTRUSTED");
  string exe = Path.GetFullPath(match.Groups[1].Value), name = Path.GetFileName(exe);
  Require(new[] { "RobloxPlayerInstaller.exe", "RobloxPlayerLauncher.exe", "RobloxPlayerBeta.exe" }.Contains(name, StringComparer.OrdinalIgnoreCase) && File.Exists(exe), "ROBLOX_PROTOCOL_UNTRUSTED");
  string local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Roblox", "Versions") + Path.DirectorySeparatorChar;
  string program86 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Roblox", "Versions") + Path.DirectorySeparatorChar;
  string program64 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Roblox", "Versions") + Path.DirectorySeparatorChar;
  Require(exe.StartsWith(local, StringComparison.OrdinalIgnoreCase) || exe.StartsWith(program86, StringComparison.OrdinalIgnoreCase) || exe.StartsWith(program64, StringComparison.OrdinalIgnoreCase), "ROBLOX_PROTOCOL_UNTRUSTED");
  var file = new LaunchTrustFile { Size = (uint)Marshal.SizeOf(typeof(LaunchTrustFile)), Path = exe };
  IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(LaunchTrustFile)));
  try {
   Marshal.StructureToPtr(file, ptr, false);
   var data = new LaunchTrustData { Size = (uint)Marshal.SizeOf(typeof(LaunchTrustData)), UI = 2, Choice = 1, File = ptr, Flags = 0x1000 };
   Require(WinVerifyTrust(new IntPtr(-1), new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE"), ref data) == 0, "ROBLOX_PROTOCOL_UNTRUSTED");
   var certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(exe));
   Require(certificate.GetNameInfo(X509NameType.SimpleName, false).Equals("Roblox Corporation", StringComparison.OrdinalIgnoreCase), "ROBLOX_PROTOCOL_UNTRUSTED");
  } finally {
   Marshal.DestroyStructure(ptr, typeof(LaunchTrustFile));
   Marshal.FreeHGlobal(ptr);
  }
 }
}
