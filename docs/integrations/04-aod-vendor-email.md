# Email template: request AOD integration access

Send to your Attendance on Demand support contact **or** your AOD reseller (see [03-aod-setup.md](03-aod-setup.md), Step 1). CC your internal AOD administrator. Replace everything in [brackets].

**Do not** include passwords or employee data in this email. Ask AOD to deliver credentials through a secure channel, not plain email.

---

**Subject:** Integration access request: [Company name], AOD account [AOD host name, e.g. yourcompany.attendanceondemand.com]

Hello,

I'm the [title] at [Company name], an Attendance on Demand customer[ through (reseller name)]. Our AOD account is at **[AOD host name]**, and our AOD administrator is [name, title], CC'd here.

We're building an internal workforce scheduling application for our skilled nursing facilities. It needs **read-only** access to our own AOD timekeeping data so we can compare scheduled shifts against actual punches, spot missing punches, and project overtime. **The application will not create, edit, or delete punches, and will not submit anything to payroll.**

Could you please help with the following?

1. **Supported integration methods.** Which methods are available for our account: AOD Web Services (CC1/SOAP), any newer REST API, scheduled exports (CSV) delivered by SFTP or email, or another supported option? Are there any additional costs or contract changes?

2. **Documentation.** The developer documentation for the method(s) you recommend, specifically for:
   - listing employees, including employee number, badge number, name, home location/workgroup, and active/inactive status;
   - extracting punches or worked segments for a date range (in/out times, location, hours, and approval status);
   - extracting approved hours per pay period, if available.

3. **Test environment.** Is a test/development database available for our account, so we can verify the integration without touching live data?

4. **Credentials.** If Web Services are available, please create a **dedicated, read-only Access Account** for this integration (test database first, if possible) and send the credentials through a secure method rather than plain email.

5. **Scheduled export (if recommended instead).** Could you configure a daily export with one row per worked segment containing: Employee Number, First Name, Last Name, Facility/Location, Date, In time, Out time, Hours, and Approved? Plus a daily employee list export. Please send a **sample file with test or fake data** first so we can confirm the format.

6. **Employee identifiers.** Which AOD field holds the employee number that matches our Paycor employee number?

7. **Existing payroll interface.** Could you confirm how hours currently flow from AOD to Paycor for our account (if they do), so our application doesn't duplicate or conflict with it?

8. **Limits.** Any rate limits, recommended sync frequency, or IP allow-listing requirements we should know about?

Thank you. Please let me know whether a short call would be easier.

Best regards,
[Name]
[Title], [Company name]
[Phone]
