using System;

internal static partial class Host {
 static void LoginProgressSelfTests(){
  var start=new DateTime(2026,11,18,0,0,0,DateTimeKind.Utc);var progress=new LoginProgress(start);
  Require(progress.BeginSubmission(start),"TEST_LOGIN_FIRST_SUBMIT");
  Require(progress.Observe("CUSTOMER_CAPTCHA_REQUIRED",true,start.AddSeconds(5))=="CUSTOMER_CAPTCHA_REQUIRED","TEST_MANUAL_CAPTCHA");
  DateTime original=progress.HumanDeadline;
  Require(progress.Timeout(start.AddSeconds(100))==""&&!progress.CanAutomate(start.AddSeconds(100)),"TEST_MANUAL_PAUSES_NINETY_SECOND_TIMEOUT");
  progress.Observe("CUSTOMER_CAPTCHA_REQUIRED",true,start.AddSeconds(200));Require(progress.HumanDeadline==original,"TEST_HUMAN_DEADLINE_NOT_EXTENDED");
  Require(progress.Timeout(original)=="CUSTOMER_CAPTCHA_REQUIRED","TEST_HUMAN_EXPIRY_RETAINS_REASON");
  progress.Observe("",false,start.AddSeconds(220));Require(!progress.WaitingForUser&&progress.Submitted&&!progress.BeginSubmission(start.AddSeconds(220)),"TEST_MANUAL_COMPLETION_NEVER_RESUBMITS");
  Require(progress.Timeout(start.AddSeconds(300))==""&&progress.Timeout(start.AddSeconds(311))=="CUSTOMER_LOGIN_TIMEOUT","TEST_POST_VERIFICATION_COOKIE_WAIT");
  progress=new LoginProgress(start);progress.BeginSubmission(start);progress.Observe("CUSTOMER_CAPTCHA_REQUIRED",true,start);Require(progress.Timeout(start.AddSeconds(601))=="CUSTOMER_CAPTCHA_REQUIRED","TEST_LONG_MANUAL_WAIT_REASON");progress.Observe("",false,start.AddSeconds(601));Require(progress.Timeout(start.AddSeconds(602))==""&&progress.Timeout(start.AddSeconds(691))=="CUSTOMER_LOGIN_TIMEOUT"&&progress.Submitted,"TEST_LATE_MANUAL_COMPLETION_GETS_COOKIE_WAIT");
  progress=new LoginProgress(start);Require(progress.Observe("",true,start)=="CUSTOMER_IDENTITY_VERIFICATION"&&!progress.CanAutomate(start),"TEST_UNREADABLE_MODAL_PAUSES");
  progress.Observe("",false,start.AddSeconds(10));Require(progress.CanAutomate(start.AddSeconds(10))&&progress.CanAutomate(start.AddSeconds(129)),"TEST_BEFORE_CLICK_MANUAL_RESUME");
  Require(!progress.CanAutomate(start.AddSeconds(131)),"TEST_REOPENED_FORM_WINDOW_STAYS_BOUNDED");
  progress=new LoginProgress(start);progress.Observe("CUSTOMER_CAPTCHA_REQUIRED",true,start.AddSeconds(2));progress.Observe("",false,start.AddSeconds(95));Require(progress.CanAutomate(start.AddSeconds(96)),"TEST_LATE_VERIFICATION_MAY_FINISH_LOGIN");
  progress=new LoginProgress(start);Require(progress.RecordFill()&&progress.RecordFill()&&progress.RecordFill()&&!progress.RecordFill(),"TEST_SAFE_FILL_BOUND");
  Require(progress.BeginSubmission(start)&&!progress.ProveNoClick("UNKNOWN")&&progress.Submitted&&!progress.BeginSubmission(start),"TEST_UNKNOWN_SUBMIT_NEVER_REPEATED");
  foreach(string status in new[]{"PENDING","CHALLENGE","EMPTY","MISSING"}){progress=new LoginProgress(start);Require(progress.BeginSubmission(start)&&progress.ProveNoClick(status)&&!progress.Submitted&&progress.BeginSubmission(start.AddSeconds(1)),"TEST_PROVEN_NO_CLICK_MAY_WAIT");}
  progress=new LoginProgress(start);Require(progress.Timeout(start.AddSeconds(60))=="LOGIN_FORM_TIMEOUT","TEST_FORM_TIMEOUT");progress.RecordFill();Require(progress.Timeout(start.AddSeconds(60))=="LOGIN_SUBMIT_TIMEOUT","TEST_SUBMIT_TIMEOUT");
 }
}
