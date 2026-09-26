import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
const SUPABASE_URL = "https://dxmyyymeyypxcjtmelvj.supabase.co";
const SUPABASE_KEY = "sb_publishable_Tp-IbPEmWXuBvZ8md8CY7Q_TCua9njd";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );

const formatDate = (value) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const formatStatus = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/^customer reply$/i, "applicant reply");

const loginView = document.querySelector("#loginView");
const dashboard = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const applicationList = document.querySelector("#applicationList");
const detail = document.querySelector("#detail");
const count = document.querySelector("#count");

let applications = [];
let selectedApplicationId = null;

async function checkAdmin() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    showLogin();
    return;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    await supabase.auth.signOut({ scope: "local" });
    loginStatus.className = "status error";
    loginStatus.textContent = "This account is not authorized as an admin.";
    showLogin();
    return;
  }

  showDashboard();
  await loadApplications();
}

function showLogin() {
  loginView.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboard.classList.remove("hidden");
}
async function loadApplications() {
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, application_number, name, last_name, email, mobile_number, status, created_at, last_activity_at",
    )
    .order("last_activity_at", { ascending: false });

  if (error) {
    detail.innerHTML = `<div class="status error">Unable to load applications: ${escapeHtml(error.message)}</div>`;
    return;
  }

  applications = data || [];
  count.textContent = applications.length;

  applicationList.innerHTML = applications.length
    ? applications
        .map(
          (application) => `
            <div
              class="application ${application.id === selectedApplicationId ? "active" : ""}"
              data-id="${escapeHtml(application.id)}"
            >
              <strong>${escapeHtml(application.application_number)}</strong>
              <small>
                ${escapeHtml(
                  [application.name, application.last_name]
                    .filter(Boolean)
                    .join(" "),
                )}
                · ${escapeHtml(formatDate(application.last_activity_at))}
              </small>
              <span class="badge">
                ${escapeHtml(formatStatus(application.status))}
              </span>
            </div>
          `,
        )
        .join("")
    : '<div class="empty" style="min-height: 220px">No applications yet.</div>';

  applicationList
    .querySelectorAll(".application")
    .forEach((element) =>
      element.addEventListener("click", () =>
        openApplication(element.dataset.id),
      ),
    );

  if (selectedApplicationId) {
    await openApplication(selectedApplicationId);
  }
}

async function openApplication(applicationId) {
  selectedApplicationId = applicationId;

  const application = applications.find(
    (item) => item.id === applicationId,
  );

  if (!application) {
    return;
  }

  applicationList
    .querySelectorAll(".application")
    .forEach((element) =>
      element.classList.toggle(
        "active",
        element.dataset.id === applicationId,
      ),
    );

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, sender_type, message, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) {
    detail.innerHTML = `<div class="status error">${escapeHtml(error.message)}</div>`;
    return;
  }

  detail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(application.application_number)}</h2>
        <p>
          ${escapeHtml(
            [application.name, application.last_name]
              .filter(Boolean)
              .join(" "),
          )}
          · ${escapeHtml(application.email || "")}
          · ${escapeHtml(application.mobile_number)}
        </p>
      </div>

      <div class="detail-actions">
        <span class="badge">
          ${escapeHtml(formatStatus(application.status))}
        </span>

        <button
          class="button danger"
          type="button"
          id="deleteApplicationButton"
        >
          Delete Application
        </button>
      </div>
    </div>

    <div class="messages">
      ${(messages || [])
        .map(
          (message) => `
            <div class="bubble ${escapeHtml(message.sender_type)}">
              <small>
                ${message.sender_type === "admin" ? "Admin" : "Applicant"}
                · ${escapeHtml(formatDate(message.created_at))}
              </small>
              ${escapeHtml(message.message).replace(/\\n/g, "<br>")}
            </div>
          `,
        )
        .join("")}
    </div>

    <form class="reply" id="adminReplyForm">
      <label>
        Reply
        <textarea
          name="message"
          required
          maxlength="5000"
          placeholder="Reply to the applicant..."
        ></textarea>
      </label>

      <button class="button" type="submit">
        Send Reply
      </button>

      <p class="status" id="replyStatus"></p>
    </form>
  `;

  document
    .querySelector("#adminReplyForm")
    .addEventListener("submit", sendAdminReply);

  document
    .querySelector("#deleteApplicationButton")
    .addEventListener("click", deleteApplication);
}

async function deleteApplication() {
  const application = applications.find(
    (item) => item.id === selectedApplicationId,
  );

  if (!application) {
    return;
  }

  const confirmed = window.confirm(
    `Delete application ${application.application_number} permanently?\\n\\nThis will also delete its entire conversation. This action cannot be undone.`,
  );

  if (!confirmed) {
    return;
  }

  const button = document.querySelector("#deleteApplicationButton");

  button.disabled = true;
  button.textContent = "Deleting...";

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", application.id);

  if (error) {
    button.disabled = false;
    button.textContent = "Delete Application";
    window.alert(`Unable to delete application: ${error.message}`);
    return;
  }

  selectedApplicationId = null;
  detail.innerHTML = `
    <div class="empty">
      Application deleted successfully.
    </div>
  `;

  await loadApplications();
}

async function sendAdminReply(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button");
  const status = document.querySelector("#replyStatus");
  const message = String(
    new FormData(form).get("message") || "",
  ).trim();

  if (!message) {
    return;
  }

  button.disabled = true;
  status.className = "status";
  status.textContent = "Sending...";

  const { error } = await supabase.from("messages").insert({
    application_id: selectedApplicationId,
    sender_type: "admin",
    message,
  });

  if (error) {
    status.className = "status error";
    status.textContent = error.message;
  } else {
    form.reset();
    status.className = "status success";
    status.textContent = "Reply sent.";
    await loadApplications();
  }

  button.disabled = false;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = document.querySelector("#loginButton");

  button.disabled = true;
  loginStatus.className = "status";
  loginStatus.textContent = "Signing in...";

  const form = new FormData(loginForm);

  const { error } = await supabase.auth.signInWithPassword({
    email: form.get("email"),
    password: form.get("password"),
  });

  if (error) {
    loginStatus.className = "status error";
    loginStatus.textContent = error.message;
  } else {
    loginForm.reset();
    await checkAdmin();
  }

  button.disabled = false;
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await supabase.auth.signOut({ scope: "local" });
  showLogin();
});

supabase.auth.onAuthStateChange(() => checkAdmin());

checkAdmin();

supabase
  .channel("admin-inbox")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "applications",
    },
    () => loadApplications(),
  )
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "messages",
    },
    () => loadApplications(),
  )
  .subscribe();