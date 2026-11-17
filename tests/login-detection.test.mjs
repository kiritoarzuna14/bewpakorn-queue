import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The host detects login problems with the shared browser script. These strings
// come from the live Sign in page (captured 2026-11-17 with a fake account), so
// a wording change or an over-narrow pattern fails here instead of silently
// turning every rejected password into a 90-second timeout.
const source = readFileSync(new URL('../native/LoginFormScripts.cs', import.meta.url), 'utf8');
const match = source.match(/internal const string IssueBody="((?:[^"\\]|\\.)*)";/);
if (!match) throw new Error('IssueBody not found');
const body = match[1].replace(/\\(["\\])/g, '$1');
const run = text => new Function('document', body)({body: {innerText: text}, querySelectorAll: () => []});

test('live login wording maps to actionable codes', () => {
  assert.equal(run('Username, email, or phone Password Incorrect username or password. Sign in'), 'CUSTOMER_PASSWORD_INVALID');
  assert.equal(run('The username or password you entered is incorrect.'), 'CUSTOMER_PASSWORD_INVALID');
  assert.equal(run('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'), 'CUSTOMER_PASSWORD_INVALID');
  assert.equal(run('Verify your identity to continue'), 'CUSTOMER_IDENTITY_VERIFICATION');
  assert.equal(run('Enter the verification code we sent to your email'), 'CUSTOMER_OTP_REQUIRED');
  assert.equal(run('Too many attempts. Please try again later.'), 'CUSTOMER_LOGIN_RATE_LIMITED');
  assert.equal(run('Approve the login request on your phone'), 'CUSTOMER_PHONE_VERIFICATION');
});

test('an ordinary login page is not reported as a problem', () => {
  assert.equal(run('Charts Marketplace Create Robux Sign Up Sign in Username, email, or phone Password Forgot password or username?'), '');
});
