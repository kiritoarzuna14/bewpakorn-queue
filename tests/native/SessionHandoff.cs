using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Local CookieManager smoke test only. Never navigates, authenticates, fills a
// form, imports into RAM, or opens an existing browser profile.
internal static class SessionHandoff {
 [STAThread] static int Main(){
  var elapsed=Stopwatch.StartNew();
  string tempRoot=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
  string profile=Path.Combine(tempRoot,"bewqueue-session-handoff-profile-"+Guid.NewGuid().ToString("N"));
  string fixture="fixture-not-an-account-"+Guid.NewGuid().ToString("N");
  bool initialized=false,found=false,valueMatched=false,domainMatched=false,pathMatched=false,secure=false,httpOnly=false,sameSiteNone=false,fixtureDeleted=false,profileDeleted=false,timedOut=false,failed=false,externalNavigationAttempted=false,externalRequestObserved=false;
  CoreWebView2 core=null;
  try{
   if(Directory.Exists(profile))throw new IOException();
   Directory.CreateDirectory(profile);
   using(var form=new Form())using(var view=new WebView2())using(var timer=new System.Windows.Forms.Timer()){
    form.Opacity=0;form.ShowInTaskbar=false;form.Width=1;form.Height=1;form.FormBorderStyle=FormBorderStyle.None;
    view.Dock=DockStyle.Fill;form.Controls.Add(view);
    // Leave five seconds of the 45-second overall budget for owned-profile cleanup.
    timer.Interval=100;timer.Tick+=(s,e)=>{if(elapsed.ElapsedMilliseconds>=40000){timedOut=true;timer.Stop();form.Close();}};
    form.Shown+=async(s,e)=>{
     timer.Start();
     try{
      var options=new CoreWebView2EnvironmentOptions();options.AdditionalBrowserArguments="--disable-background-networking --disable-component-update --disable-sync --disable-domain-reliability --no-pings";
      var environment=await CoreWebView2Environment.CreateAsync(null,profile,options);
      if(timedOut||form.IsDisposed)return;
      await view.EnsureCoreWebView2Async(environment);
      if(timedOut||form.IsDisposed)return;
      core=view.CoreWebView2;initialized=true;
      core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
      core.NewWindowRequested+=(a,b)=>{externalNavigationAttempted=true;b.Handled=true;};
      core.NavigationStarting+=(a,b)=>{if(b.Uri!="about:blank")externalNavigationAttempted=true;b.Cancel=true;};
      core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);
      core.WebResourceRequested+=(a,b)=>{externalRequestObserved=true;b.Response=environment.CreateWebResourceResponse(null,403,"Blocked","");};
      var cookie=core.CookieManager.CreateCookie(".ROBLOSECURITY",fixture,".roblox.com","/");
      cookie.IsHttpOnly=true;cookie.IsSecure=true;cookie.SameSite=CoreWebView2CookieSameSiteKind.None;
      core.CookieManager.AddOrUpdateCookie(cookie);
      var cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");
      foreach(var item in cookies){
       if(item.Name!=".ROBLOSECURITY")continue;
       found=true;valueMatched=item.Value==fixture;domainMatched=item.Domain==".roblox.com";pathMatched=item.Path=="/";
       secure=item.IsSecure;httpOnly=item.IsHttpOnly;sameSiteNone=item.SameSite==CoreWebView2CookieSameSiteKind.None;
      }
      core.CookieManager.DeleteAllCookies();
      cookies=await core.CookieManager.GetCookiesAsync("https://www.roblox.com/");
      fixtureDeleted=true;foreach(var item in cookies)if(item.Name==".ROBLOSECURITY")fixtureDeleted=false;
     }catch{failed=true;}
     finally{
      fixture=null;
      if(core!=null)try{core.CookieManager.DeleteAllCookies();}catch{failed=true;}
      timer.Stop();if(!form.IsDisposed)form.Close();
     }
    };
    Application.Run(form);
   }
  }catch{failed=true;}
  finally{
   fixture=null;core=null;
   try{
    string full=Path.GetFullPath(profile);
    if(!String.Equals(Path.GetDirectoryName(full),tempRoot,StringComparison.OrdinalIgnoreCase)||!Regex.IsMatch(Path.GetFileName(full),@"^bewqueue-session-handoff-profile-[0-9a-f]{32}$"))throw new IOException();
    do{
     try{if(Directory.Exists(full)){CheckOwnedTree(full);Directory.Delete(full,true);}profileDeleted=!Directory.Exists(full);if(profileDeleted)break;}catch(IOException){}catch(UnauthorizedAccessException){}
     if(elapsed.ElapsedMilliseconds>=45000)break;
     Thread.Sleep(100);
    }while(true);
   }catch{failed=true;}
  }
  bool passed=initialized&&found&&valueMatched&&domainMatched&&pathMatched&&secure&&httpOnly&&sameSiteNone&&fixtureDeleted&&profileDeleted&&!timedOut&&!failed&&!externalNavigationAttempted&&!externalRequestObserved;
  Console.WriteLine("{\"initialized\":"+B(initialized)+",\"fixtureFound\":"+B(found)+",\"valueMatched\":"+B(valueMatched)+",\"domainMatched\":"+B(domainMatched)+",\"pathMatched\":"+B(pathMatched)+",\"secure\":"+B(secure)+",\"httpOnly\":"+B(httpOnly)+",\"sameSiteNone\":"+B(sameSiteNone)+",\"fixtureDeleted\":"+B(fixtureDeleted)+",\"profileDeleted\":"+B(profileDeleted)+",\"externalNavigationAttempted\":"+B(externalNavigationAttempted)+",\"externalRequestObserved\":"+B(externalRequestObserved)+",\"timedOut\":"+B(timedOut)+",\"failed\":"+B(failed)+",\"passed\":"+B(passed)+"}");
  return passed?0:1;
 }
 static string B(bool value){return value?"true":"false";}
 static void CheckOwnedTree(string folder){
  if((File.GetAttributes(folder)&FileAttributes.ReparsePoint)!=0)throw new IOException();
  foreach(var path in Directory.GetFileSystemEntries(folder)){
   if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException();
   if(Directory.Exists(path))CheckOwnedTree(path);
  }
 }
}
