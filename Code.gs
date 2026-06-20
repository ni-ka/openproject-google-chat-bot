// =========================================================================
// 1. CHAT BOT INTERFACE (Plan B: Asynchronous Workaround)
// =========================================================================

/**
 * Triggered when the bot is added to a Space.
 */
function onAddedToSpace(event) {
  console.log("Bot added to space event:", JSON.stringify(event));

  // Safely extract the space name
  const space = event.space || (event.chat && event.chat.space) || (event.chat && event.chat.messagePayload && event.chat.messagePayload.space);

  if (space && space.name) {
    // Send the welcome message asynchronously via the Service Account
    postToChat(space.name, "Hello! I'm the OpenProject bot. Use `@Openproject bot /subscribe <Project Title>` to link this space to an OpenProject.");
  }

  // Return an empty object to satisfy the webhook and prevent the crash
  return {};
}

// =========================================================================
// 3. GOOGLE CHAT COMMAND LISTENER (Add-on Compatible)
// =========================================================================

function onMessage(event) {
  try {
    const message = event.message || (event.chat && event.chat.messagePayload && event.chat.messagePayload.message);
    const space = event.space || (event.chat && event.chat.space) || (event.chat && event.chat.messagePayload && event.chat.messagePayload.space);

    if (!message || !space) {
      console.error("Missing message or space property in payload!");
      return {};
    }

    const spaceName = space.name;
    const properties = PropertiesService.getScriptProperties();

    // Helper function to send the message directly through the Add-on return block
    function reply(text) {
      return {
        hostAppDataAction: {
          chatDataAction: {
            createMessageAction: {
              message: { text: text } // Inject the real message right here!
            }
          }
        }
      };
    }

    // Extract the text and clean it
    let rawText = message.argumentText ? message.argumentText : message.text;
    let messageText = (rawText || "").replace(/\n/g, ' ').trim();

    // Auto-correct missing slashes
    if (messageText.startsWith('subscribe')) messageText = '/' + messageText;
    if (messageText.startsWith('connect')) messageText = '/' + messageText;

    // ---------------------------------------------------------
    // Command 1: /connect
    // ---------------------------------------------------------
    if (messageText.startsWith("/connect")) {
      const parts = messageText.split(/\s+/);
      if (parts.length < 3) {
        return reply("⚠️ Usage: `/connect [OpenProject URL] [API Token]`");
      }

      const opUrl = parts[1].replace(/\/+$/, "");
      const opToken = parts[2];

      try {
        const testUrl = `${opUrl}/api/v3/users/me`;
        const options = {
          method: 'get',
          headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(`apikey:${opToken}`) },
          muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch(testUrl, options);
        const responseCode = response.getResponseCode();

        if (responseCode === 200) {
          const userData = JSON.parse(response.getContentText());

          properties.setProperty('OP_URL', opUrl);
          properties.setProperty('OP_TOKEN', opToken);

          return reply(`✅ Successfully connected to OpenProject at ${opUrl}\nAuthenticated as: **${userData.name}**`);
        } else if (responseCode === 401 || responseCode === 403) {
          return reply(`❌ Connection failed: Unauthorized. Please verify your API token.`);
        } else {
          return reply(`❌ Connection failed with HTTP ${responseCode}. Please check the URL.`);
        }
      } catch (error) {
        return reply(`❌ Connection error: Could not reach the server.\n*Error details: ${error.message}*`);
      }
    }

    // ---------------------------------------------------------
    // Command 2: /subscribe
    // ---------------------------------------------------------
    if (messageText.startsWith('/subscribe')) {
      const projectTitle = messageText.substring('/subscribe'.length).trim();

      if (!projectTitle) {
        return reply("⚠️ Usage: `/subscribe <Project Title>`");
      }

      properties.setProperty(`SPACE_FOR_PROJECT_${projectTitle}`, spaceName);

      return reply(`✅ This space is now subscribed to the OpenProject: **${projectTitle}**`);
    }

    // ---------------------------------------------------------
    // Fallback Command
    // ---------------------------------------------------------
    return reply("I didn't recognize that command. Try `/subscribe [Project Title]` or `/connect [URL] [Token]`.");

  } catch (error) {
    console.error(error);
    // Even if it crashes, we must return the Add-on structure
    return {
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { text: "⚠️ Script crashed. Check Apps Script logs." }
          }
        }
      }
    };
  }
}

// =========================================================================
// 2. WEBHOOK LISTENER (Link Formatting Polish)
// =========================================================================

function doPost(e) {
  try {
    const rawData = e.postData.contents;
    const payload = JSON.parse(rawData);
    const action = payload.action;

    let workPackage = null;
    let isStandaloneComment = false;

    if (action === "work_package_comment:comment") {
      workPackage = payload.activity && payload.activity._embedded ? payload.activity._embedded.workPackage : null;
      isStandaloneComment = true;
    } else {
      workPackage = payload.work_package;
    }

    if (!workPackage) return ContentService.createTextOutput("Ignored: Not a recognized work package event");

    // Extract project title
    let projectTitle = null;
    if (workPackage._embedded && workPackage._embedded.project) {
      projectTitle = workPackage._embedded.project.name;
    } else if (workPackage._links && workPackage._links.project) {
      projectTitle = workPackage._links.project.title;
    }

    if (!projectTitle) return ContentService.createTextOutput("Ignored: No project title found");

    const properties = PropertiesService.getScriptProperties();
    const targetSpace = properties.getProperty(`SPACE_FOR_PROJECT_${projectTitle}`);

    if (!targetSpace) return ContentService.createTextOutput("Ignored: Project not subscribed");

    let messageText = null;
    const baseUrl = properties.getProperty('OP_URL') || "";
    const taskUrl = workPackage._links && workPackage._links.self ? baseUrl + workPackage._links.self.href.replace('/api/v3', '') : "";

    // ---------------------------------------------------------
    // Format the Beautiful Title (e.g. "TASK #11590: Subject")
    // ---------------------------------------------------------
    let wpType = "Task";
    if (workPackage._embedded && workPackage._embedded.type && workPackage._embedded.type.name) {
      wpType = workPackage._embedded.type.name;
    } else if (workPackage._links && workPackage._links.type && workPackage._links.type.title) {
      wpType = workPackage._links.type.title;
    }
    const formattedSubject = `${wpType.toUpperCase()} #${workPackage.id}: ${workPackage.subject}`;

    // ---------------------------------------------------------
    // Helper Functions
    // ---------------------------------------------------------
    function getAuthorName(baseObj, fullPayload) {
      const possibleKeys = ['author', 'user', 'actor', 'creator'];
      let targetId = null;

      if (baseObj && baseObj._links) {
        for (let key of possibleKeys) {
          if (baseObj._links[key] && baseObj._links[key].href) {
            const parts = baseObj._links[key].href.split('/');
            targetId = parts[parts.length - 1];
            break;
          }
        }
      }

      if (targetId) {
        const resolvedName = resolveOpenProjectUser(targetId);
        if (resolvedName) return resolvedName;
      }

      if (baseObj) {
        for (let key of possibleKeys) {
          if (baseObj._embedded && baseObj._embedded[key] && baseObj._embedded[key].name) return baseObj._embedded[key].name;
          if (baseObj._links && baseObj._links[key] && baseObj._links[key].title) return baseObj._links[key].title;
          if (baseObj[key] && baseObj[key].name) return baseObj[key].name;
        }
      }

      return "Someone";
    }

    function translateMentions(rawText) {
      if (!rawText) return "";
      let text = rawText.replace(/\[([^\]]+)\]\([^)]+\/users\/\d+\)/gi, (match, userName) => {
        return getChatMention(userName.trim().replace(/^@/, ''));
      });
      text = text.replace(/<mention\b[^>]*>([\s\S]*?)<\/mention>/gi, (match, innerText) => {
        return getChatMention(innerText.trim().replace(/^@/, ''));
      });
      return text;
    }

    function cleanMarkdown(rawText) {
      if (!rawText) return "";
      let text = rawText;
      text = text.replace(/&nbsp;/g, " "); // Strip HTML spaces
      text = text.replace(/\[x\]/gi, "✅"); // Convert checked boxes
      text = text.replace(/\[ \]/g, "⬜"); // Convert empty boxes

      // Convert standard Markdown links [text](url) to Google Chat links <url|text>
      // The (^|[^!]) ensures we don't accidentally break image tags if they exist
      text = text.replace(/(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g, "$1<$3|$2>");

      text = text.replace(/\n\s*\n\s*\*/g, "\n*"); // Tighten up bullet point spacing
      text = text.replace(/\n{3,}/g, "\n\n"); // Collapse 3+ empty lines into 2
      return text.trim();
    }

    // ---------------------------------------------------------
    // Event 1: Standalone Comment
    // ---------------------------------------------------------
    if (isStandaloneComment) {
      const activity = payload.activity;
      let rawComment = activity.comment ? activity.comment.raw : null;

      if (!rawComment) return ContentService.createTextOutput("Ignored: Empty comment");

      let editorName = payload.actor && payload.actor.name ? payload.actor.name : getAuthorName(activity, payload);

      // Order of operations: Translate mentions first, then convert standard links
      let translatedComment = translateMentions(rawComment);
      let finalComment = cleanMarkdown(translatedComment);

      messageText = `💬 New Comment by ${editorName} on <${taskUrl}|${formattedSubject}>\n"${finalComment}"`;
    }
    // ---------------------------------------------------------
    // Event 2: New Task Created
    // ---------------------------------------------------------
    // else if (action === "work_package:created") {
    //   let creatorName = payload.actor && payload.actor.name ? payload.actor.name : getAuthorName(workPackage, payload);
    //   messageText = `✨ New Task Created by ${creatorName}: <${taskUrl}|${formattedSubject}>`;

    //   const assignee = workPackage._embedded ? workPackage._embedded.assignee : null;
    //   if (assignee && assignee.name) {
    //     messageText += `\nAssigned to: ${getChatMention(assignee.name)}`;
    //   }
    // }
    // ---------------------------------------------------------
    // Event 3: Task Updated
    // ---------------------------------------------------------
    else if (action === "work_package:updated") {
      const latestActivity = getLatestActivity(workPackage.id);
      if (!latestActivity) return ContentService.createTextOutput("Ignored: Could not fetch activity details");

      // Grab the editor's name
      let editorName = payload.actor && payload.actor.name ? payload.actor.name : getAuthorName(latestActivity, payload);

      // Stringify the details array to search the raw English text
      const detailsString = latestActivity.details ? JSON.stringify(latestActivity.details) : "";

      // 1. Detect Assignee Change
      const assigneeChanged = /Assignee changed/i.test(detailsString);

      // 2. Detect Status Changes
      const isStatusChange = /Status changed/i.test(detailsString);
      let currentStatus = workPackage._embedded && workPackage._embedded.status ? workPackage._embedded.status.name : "Unknown";

      // It changed TO closed (Current status is Closed)
      const statusChangedToClosed = isStatusChange && currentStatus === "Closed";
      // It changed FROM closed (The raw text literally says "from Closed")
      const statusChangedFromClosed = isStatusChange && /from Closed/i.test(detailsString);

      // 3. Detect Comments
      const hasComment = latestActivity.comment && latestActivity.comment.raw && latestActivity.comment.raw.trim().length > 0;

      // Drop routine updates (like dates and subjects)
      if (!assigneeChanged && !hasComment && !statusChangedToClosed && !statusChangedFromClosed) {
        return ContentService.createTextOutput("Ignored: Routine update");
      }

      // Build the final messages
      if (statusChangedToClosed) {
        messageText = `✅ Task Closed by ${editorName}: <${taskUrl}|${formattedSubject}>`;
      }
      else if (statusChangedFromClosed) {
        messageText = `🔄 Task Reopened (Status: ${currentStatus}) by ${editorName}: <${taskUrl}|${formattedSubject}>`;
      }
      else if (assigneeChanged) {
        const assignee = workPackage._embedded ? workPackage._embedded.assignee : null;
        const newAssigneeName = (assignee && assignee.name) ? assignee.name : "Unassigned";
        messageText = `📋 Assignee Changed by ${editorName}: <${taskUrl}|${formattedSubject}>\nNow assigned to: ${getChatMention(newAssigneeName)}`;
      }
      else if (hasComment) {
        let rawComment = latestActivity.comment.raw;
        let translatedComment = translateMentions(rawComment);
        let finalComment = cleanMarkdown(translatedComment);
        messageText = `💬 New Comment by ${editorName} on <${taskUrl}|${formattedSubject}>\n"${finalComment}"`;
      }
    }

    if (messageText) {
      postToChat(targetSpace, messageText);
    }

    return ContentService.createTextOutput("Success");
  } catch (error) {
    console.error("Error processing Webhook:", error);
    return ContentService.createTextOutput("Error processing webhook");
  }
}
// =========================================================================
// 3. HELPER FUNCTIONS
// =========================================================================

/**
 * Pushes the message asynchronously to Google Chat using Service Account credentials.
 */
function postToChat(spaceName, text) {
  try {
    const serviceAccountToken = getServiceAccountToken();

    if (!serviceAccountToken) {
      console.error("Failed to generate Service Account token.");
      return;
    }

    // We MUST use a raw HTTP request to successfully pass the Service Account Bearer token
    const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${serviceAccountToken}`
      },
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true // This forces Apps Script to log Google's exact error message instead of failing silently
    };

    const response = UrlFetchApp.fetch(url, options);

    // Log the exact response from Google's servers
    console.log("Google Chat API Response:", response.getContentText());

  } catch (error) {
    console.error(`Failed to post message to space ${spaceName}:`, error);
  }
}

/**
 * Configures the OAuth2 service to act as the Google Chat Bot.
 */
function getChatBotService() {
  const properties = PropertiesService.getScriptProperties();
  const clientEmail = properties.getProperty('CLIENT_EMAIL');

  // Apps script properties sometimes escape newlines. This ensures the key is formatted correctly.
  const privateKey = properties.getProperty('PRIVATE_KEY').replace(/\\n/g, '\n');

  return OAuth2.createService('ChatBot')
    // Set the endpoint URL.
    .setTokenUrl('https://oauth2.googleapis.com/token')
    // Set the private key and issuer.
    .setPrivateKey(privateKey)
    .setIssuer(clientEmail)
    // Set the property store where tokens should be cached.
    .setPropertyStore(PropertiesService.getScriptProperties())
    // Set the scope required to post as a Chat App/Bot.
    .setScope('https://www.googleapis.com/auth/chat.bot');
}

/**
 * Generates and retrieves the Service Account Bearer token.
 */
function getServiceAccountToken() {
  const service = getChatBotService();

  if (service.hasAccess()) {
    return service.getAccessToken();
  } else {
    console.error('Service Account Error:', service.getLastError());
    return null;
  }
}

/**
 * Looks up a user dynamically in the Google Workspace directory.
 * If found, returns a real Google Chat ping. If not, returns bold text.
 */
function getChatMention(openProjectName) {
  try {
    // Search the Workspace Directory for the exact name
    const response = AdminDirectory.Users.list({
      customer: 'my_customer',
      query: `name:'${openProjectName}'`,
      maxResults: 1,
      viewType: 'domain_public'
    });

    // If the user is found, return the phone-buzzing Chat ID tag
    if (response.users && response.users.length > 0) {
      return `<users/${response.users[0].id}>`;
    }
  } catch (error) {
    console.error(`Failed to look up ${openProjectName} in directory:`, error.toString());
  }

  // Fallback: If they aren't in your Workspace, just bold their name
  return `${openProjectName}`;
}

/**
 * Calls OpenProject to fetch the exact changes (activity journal) that triggered this update.
 */
function getLatestActivity(workPackageId) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = properties.getProperty('OP_URL');
  const token = properties.getProperty('OP_TOKEN');

  if (!baseUrl || !token) return null;

  try {
    const url = `${baseUrl}/api/v3/work_packages/${workPackageId}/activities`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(`apikey:${token}`)
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      // OP returns activities in an array. We want the most recent one (the last element).
      if (data._embedded && data._embedded.elements && data._embedded.elements.length > 0) {
        return data._embedded.elements[data._embedded.elements.length - 1];
      }
    }
  } catch (error) {
    console.error("Error fetching activity:", error.toString());
  }
  return null;
}

/**
 * Run to test admin directory lookup - not used in webhook or chat bot
 */
function testAdminDirectoryLookup() {
  const testName = "CHANGEME"; // The exact name you are searching for
  console.log(`Starting Workspace Directory search for: '${testName}'`);

  try {
    const response = AdminDirectory.Users.list({
      customer: 'my_customer',
      query: `name:'${testName}'`,
      maxResults: 1,
      viewType: 'domain_public'
    });

    console.log("Raw API Response:", JSON.stringify(response));

    if (response.users && response.users.length > 0) {
      const user = response.users[0];
      console.log(`✅ Success! Found user.`);
      console.log(`Name: ${user.name.fullName}`);
      console.log(`Email: ${user.primaryEmail}`);
      console.log(`ID: ${user.id}`);
      console.log(`Chat Mention Format: <users/${user.id}>`);
    } else {
      console.warn("⚠️ API request succeeded, but no user was found matching that name.");
    }
  } catch (error) {
    console.error("❌ Admin API Error:", error.toString());
    console.log("Hint: If you see a 'Not Authorized' or 'Forbidden' error, your Workspace Admin may have blocked Domain-Wide search, or you need to re-authenticate.");
  }
}
