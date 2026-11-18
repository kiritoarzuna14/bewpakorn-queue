using System;

// No credentials or browser actions: this policy only controls when the host
// may prepare/submit and when a human verification must keep its real reason.
internal sealed class LoginProgress {
 internal readonly DateTime FormDeadline;
 internal DateTime LoginDeadline=DateTime.MaxValue,HumanDeadline=DateTime.MaxValue;
 internal bool Submitted,WaitingForUser;
 internal int Fills;
 internal string LastManualCode;
 internal LoginProgress(DateTime now){FormDeadline=now.AddSeconds(60);}
 internal static bool Manual(string code){return code=="CUSTOMER_CAPTCHA_REQUIRED"||code=="CUSTOMER_OTP_REQUIRED"||code=="CUSTOMER_PHONE_VERIFICATION"||code=="CUSTOMER_IDENTITY_VERIFICATION";}
 internal string Observe(string issue,bool visibleDialog,DateTime now){
  string manual=Manual(issue)?issue:String.IsNullOrEmpty(issue)&&visibleDialog?"CUSTOMER_IDENTITY_VERIFICATION":"";
  if(manual!=""){if(HumanDeadline==DateTime.MaxValue)HumanDeadline=now.AddMinutes(10);WaitingForUser=true;LastManualCode=manual;return manual;}
  if(WaitingForUser){WaitingForUser=false;LoginDeadline=now.AddSeconds(90);}
  return "";
 }
 internal bool CanAutomate(DateTime now){return !Submitted&&!WaitingForUser&&now<FormDeadline;}
 internal bool BeginSubmission(DateTime now){if(!CanAutomate(now))return false;Submitted=true;LoginDeadline=now.AddSeconds(90);return true;}
 internal bool ProveNoClick(string status){if(status!="PENDING"&&status!="CHALLENGE"&&status!="EMPTY"&&status!="MISSING")return false;Submitted=false;return true;}
 internal bool RecordFill(){if(Fills>=3)return false;Fills++;return true;}
 internal string Timeout(DateTime now){
  if(WaitingForUser)return now>=HumanDeadline?LastManualCode:"";
  if(Submitted||HumanDeadline!=DateTime.MaxValue)return now>=LoginDeadline?"CUSTOMER_LOGIN_TIMEOUT":"";
  return now>=FormDeadline?(Fills>0?"LOGIN_SUBMIT_TIMEOUT":"LOGIN_FORM_TIMEOUT"):"";
 }
}
