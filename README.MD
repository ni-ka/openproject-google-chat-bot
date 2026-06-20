# 🚀 OpenProject to Google Chat Integration

This project is a custom Google Apps Script integration that connects OpenProject with Google Chat. It acts as a middleware that listens to OpenProject webhooks, dynamically looks up missing data via the OpenProject API, translates OpenProject `@mentions` into native Google Workspace directory pings, and delivers beautifully formatted notifications directly into your Google Chat spaces.

## ✨ Features
* **Smart Mentions:** Dynamically searches your Google Workspace Directory to translate OpenProject names into real Google Chat tags (buzzes phones!).
* **API Fallback:** Automatically fetches missing activity logs and author names that OpenProject leaves out of its webhook payloads.
* **Markdown Translation:** Converts OpenProject Markdown (links, checkboxes, bullet points) into native Google Chat formatting.
* **Noise Filtering:** Drops routine updates (like date or subject changes) and only alerts on Comments, Assignee changes, Task Creation, and Task Closures/Reopens.
* **Slash Commands:** Easily connect OpenProject API tokens and subscribe individual chat spaces to specific projects natively from Google Chat.

---

## 🛠️ Phase 1: Google Cloud & Workspace Setup

To allow the script to search your company directory for `@mentions`, you must enable the Google Admin SDK.

1. Create a new [Google Apps Script](https://script.google.com/) project.
2. On the left sidebar, click the **Gear Icon (Project Settings)**.
3. Under **Google Cloud Platform (GCP) Project**, click the project number link to open your Google Cloud Console.
4. In Google Cloud, navigate to **APIs & Services > Library**.
5. Search for **Admin SDK API** and click **Enable**.
6. Search for **Google Chat API** and click **Enable**.
7. Close Google Cloud and return to your Apps Script editor.

---

## 💻 Phase 2: Apps Script Configuration

### 1. Update the Manifest File (`appsscript.json`)
You must explicitly grant the script permission to read the Workspace directory and communicate with external webhooks.

1. In the Apps Script editor, click **Project Settings** (Gear Icon).
2. Check the box for **"Show 'appsscript.json' manifest file in editor"**.
3. Click the **Code (`< >`)** icon to return to the editor.
4. Open `appsscript.json` and replace its contents with the following:

{
  "timeZone": "Africa/Dakar",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "AdminDirectory",
        "serviceId": "admin",
        "version": "directory_v1"
      }
    ]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.storage",
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/chat.bot"
  ],
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}

### 2. Add the Code
1. Open `Code.gs`.
2. Paste the finalized JavaScript code (containing `doPost`, `onMessage`, `getLatestActivity`, etc.) into the editor.
3. Click the **Save** icon.

---

## 🌐 Phase 3: Deployment

This script requires **two** connection points: A Web App URL (for OpenProject) and a Deployment ID (for Google Chat).

### 1. Generate the Webhook URL
1. Click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set "Execute as" to **Me**.
4. Set "Who has access" to **Anyone**.
5. Click **Deploy**.
6. **Copy the Web app URL**. You will need this for OpenProject.

### 2. Configure the Google Chat App
1. Go to **Deploy > Manage deployments** and copy the **Deployment ID**.
2. Open your Google Cloud Console and navigate to **APIs & Services > Google Chat API > Configuration**.
3. Fill out the App Name, Avatar URL, and Description.
4. Under **Interactive features**, toggle it **ON**.
5. Under **Connection settings**, select **Apps Script project** and paste your **Deployment ID**.
6. Under **Slash commands**, register your two commands:
   * **Name:** `/connect` | **Description:** Link OpenProject API
   * **Name:** `/subscribe` | **Description:** Subscribe space to a project
7. Click **Save**.

*(Note: Whenever you change the code in the future, you must go to **Deploy > Manage deployments > Edit (Pencil) > Version: New Version > Deploy** for the changes to take effect.)*

---

## 🔗 Phase 4: OpenProject Webhook Setup

1. Log into OpenProject as an Administrator.
2. Go to **Administration > Webhooks**.
3. Create a new Webhook.
4. Paste the **Web app URL** you generated in Phase 3.
5. Check the following trigger events:
   * `Work package created`
   * `Work package updated`
   * `Comment added` (Activity::Comment)
6. Save the webhook.

---

## 🎮 Phase 5: Initialization & Usage

Invite your newly created bot to a Google Chat Space. Once invited, you must run two commands to initialize the integration.

### 1. Connect the API
Generate an API token in OpenProject (*Avatar > My Account > Access tokens > API*). Then, in Google Chat, run:

/connect https://openproject.yourdomain.com YOUR_API_TOKEN

*The bot will immediately test the connection. If successful, it will reply with your OpenProject name.*

### 2. Subscribe the Space
Tell the bot which OpenProject project should send notifications to this specific Chat Space:

/subscribe [Exact OpenProject Project Name]

*Example: `/subscribe kaikai - bizdev`*

### 🎉 You are done! 
The bot will now silently listen in the background, automatically fetching history, translating markdown, and tagging your team members whenever relevant updates happen in OpenProject.
