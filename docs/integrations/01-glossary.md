# Glossary: technical terms in plain English

| Term | What it actually means |
|---|---|
| **API** | A way for two computer systems to talk to each other directly, without a person copying data between screens. Like a drive-through window: our app asks for something specific ("list employees") and Paycor hands it over. |
| **Integration** | The overall connection between two systems: the API, the credentials, and the rules about what data flows where. |
| **Endpoint** | One specific "window" in an API. For example, the one that returns employees. It looks like a web address. |
| **Developer portal** | A website the vendor runs for people building integrations. It has documentation, a place to register your app, and your credentials. |
| **Sandbox** | A practice copy of the vendor's system filled with fake data. Mistakes there can't hurt anything real. Always test there first. |
| **Production** | The real system with your real employees. Only connect here after sandbox testing works. |
| **Credentials** | The usernames, passwords, and keys that prove our app is allowed in. Treat them exactly like bank passwords. |
| **Client ID** | A public name for our app, like a username. Not secret by itself. |
| **Client secret** | The password for our app. **Secret.** Never paste it into chat, email, or a document. |
| **Subscription key (APIm key)** | A second key Paycor requires on every request. It identifies which Paycor API product (sandbox or production) you're using. **Secret.** |
| **OAuth** | A safe way to give an app access without handing it your personal password. You log in to Paycor yourself and click "Allow", and Paycor gives our app a limited pass. |
| **Authorization / activation** | The moment a Paycor admin clicks "Allow" for our app. In Paycor this is done once per legal entity. |
| **Access token** | The short-lived pass (about 30 minutes for Paycor) our app shows on each request. The app renews it automatically. |
| **Refresh token** | A longer-lived pass used only to get new access tokens, so you don't have to click "Allow" every 30 minutes. Stored encrypted. |
| **Redirect URL (callback URL)** | The web address Paycor sends you back to after you click "Allow". It must exactly match what's registered in the portal, or Paycor refuses. |
| **Scope / permission** | Which kinds of data our app may see (for example "employee demographics: read"). We request the minimum needed. |
| **Legal entity** | In Paycor, a separate company/EIN. A healthcare group often has several (for example one per facility). Each must activate our app. |
| **Environment variable** | A setting stored *outside* the code, on the computer or hosting service that runs the app. This is how secrets are kept out of GitHub. |
| **`.env.local` file** | A file on your own computer holding environment variables. It's excluded from GitHub automatically. |
| **Secrets manager** | A hosting service's secure vault for environment variables (for example Vercel's "Environment Variables" screen). |
| **Sync (synchronization)** | Our app fetching the latest data from Paycor or AOD and updating its copy. |
| **Web services / SOAP** | An older style of API that AOD uses. Same idea as an API, different format (XML). |
| **WSDL** | A machine-readable menu of what an AOD web service can do. Our "Test connection" reads it to list the available functions. |
| **Access Account (AOD)** | A special AOD login meant for software, separate from any person's login. AOD or your reseller sets it up. |
| **SFTP** | A secure way to drop files into a shared folder automatically. Some vendors deliver nightly export files this way. |
| **Scheduled export** | A report the vendor system generates automatically (for example every night) as a CSV file. |
| **CSV** | A simple spreadsheet file format (opens in Excel). |
| **Employee identifier / employee number** | The ID number both systems use for the same person. Matching depends on it being identical in Paycor and AOD. |
| **Reconciliation** | Comparing two systems to find where they disagree (for example someone punching in AOD who's terminated in Paycor). |
| **Mock data** | Fake data built into the app for testing. Always labeled **MOCK DATA - NOT REAL**. |
| **HTTP status codes** | Numbers a system replies with. 200 = OK. 401 = "who are you?" (bad credentials). 403 = "I know you, but you're not allowed". 404 = "that address doesn't exist". 429 = "slow down". 500+ = "the vendor's system had a problem". |
