import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";

const SUPABASE_URL = "https://dxmyyymeyypxcjtmelvj.supabase.co";
const SUPABASE_KEY = "sb_publishable_Tp-IbPEmWXuBv8zmd8CY7Q_TCua9njd";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[character]);

const formatDate = (value) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const formatStatus = (value) => String(value || "").replace(/_/g, " ").replace(/^customer reply$/i, "applicant reply");

const loginView = document.querySelector("#loginView");
const dashboard = document.querySelector("#dashboardView");
const loginForm = document.querySelector("#loginForm");
const loginStatus = document.querySelector("#loginStatus");
const applicationList = document.querySelector("#applicationList");
const count = document.querySelector("#count");
const detail = document.querySelector("#detail");
const searchInput = document.querySelector("#searchInput");
const statusFilter = document.querySelector("#statusFilter");
const previousPageButton = document.querySelector("#previousPageButton");
const nextPageButton = document.querySelector("#nextPageButton");
const pageLabel = document.querySelector("#pageLabel");

const PAGE_SIZE = 50;
let applications = [];
let totalApplicationCount = 0;
let currentPage = 0;
let selectedApplicationId = null;
let selectedApplication = null;
let selectedMessages = [];
let loadSequence = 0;
let authCheckPromise = null;
let adminChannel = null;
let realtimeRefreshTimer = null;
let searchDebounce = null;

function isNearBottom(element, threshold = 120) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function scrollDetailMessages(smooth = true) {
  const messages = detail.querySelector(".messages");
  if (messages) messages.scrollTo({ top: messages.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function autoGrowTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
}

function wireAdminComposer() {
  const form = document.querySelector("#adminReplyForm");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "true";
  const textarea = form.elements.message;
  textarea.addEventListener("input", () => autoGrowTextarea(textarea));
  textarea.addEventListener("focus", () => setTimeout(() => textarea.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250));
  autoGrowTextarea(textarea);
  form.addEventListener("submit", sendAdminReply);
}

function renderMessages(messages, initial = false) {
  const container = detail.querySelector(".messages");
  if (!container) return;

  const wasNearBottom = initial || isNearBottom(container);
  const newestId = messages && messages.length ? messages[messages.length - 1].id : "";
  const oldNewestId = container.dataset.lastMessageId || "";
  if (!initial && newestId === oldNewestId) return;

  container.innerHTML = (messages || []).map((message) =>
    '<div class="bubble ' + escapeHtml(message.sender_type) + '">' +
      '<small>' + (message.sender_type === "admin" ? "You" : "Applicant") + " · " + escapeHtml(formatDate(message.created_at)) + '</small>' +
      '<div class="message-text">' + escapeHtml(message.message).replace(/\n/g, "<br>") + "</div>" +
    "</div>"
  ).join("");
  container.dataset.lastMessageId = newestId;

  if (wasNearBottom) requestAnimationFrame(() => scrollDetailMessages(!initial));
}

function renderDetail(application, messages, initial = false) {
  selectedApplication = application;
  selectedMessages = messages || [];

  if (initial || !document.querySelector("#adminReplyForm")) {
    detail.innerHTML =
      '<div class="detail-head">' +
        '<div><span class="conversation-eyebrow">APPLICATION</span>' +
        '<h2 id="detailApplicationNumber">' + escapeHtml(application.application_number) + '</h2>' +
        '<p id="detailApplicant">' +
          escapeHtml([application.name, application.last_name].filter(Boolean).join(" ")) + " · " +
          escapeHtml(application.email || "") + " · " +
          escapeHtml(application.mobile_number) +
        '</p></div>' +
        '<div class="detail-actions">' +
          '<span class="live-pill"><i></i> Live</span>' +
          '<span class="badge" id="detailStatus">' + escapeHtml(formatStatus(application.status)) + '</span>' +
          '<button class="button danger" type="button" id="deleteApplicationButton">Delete Application</button>' +
        '</div>' +
      '</div>' +
      '<div class="messages" aria-live="polite"></div>' +
      '<form class="reply" id="adminReplyForm">' +
        '<label>Reply' +
          '<textarea name="message" required maxlength="5000" rows="1" placeholder="Reply to the applicant..."></textarea>' +
        '</label>' +
        '<div class="composer-actions">' +
          '<span class="composer-hint">Replies are delivered instantly.</span>' +
          '<button class="button send-button" type="submit"><span>Send</span><span aria-hidden="true">↑</span></button>' +
        '</div>' +
        '<p class="status" id="replyStatus" role="status"></p>' +
      '</form>';

    wireAdminComposer();
    document.querySelector("#deleteApplicationButton").addEventListener("click", deleteApplication);
  }

  const status = document.querySelector("#detailStatus");
  if (status) status.textContent = formatStatus(application.status);
  renderMessages(selectedMessages, initial);
}

function showLogin() {
  loginView.classList.remove("hidden");
  dashboard.classList.add("hidden");
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

async function removeRealtimeChannel() {
  if (adminChannel) {
    await supabase.removeChannel(adminChannel);
    adminChannel = null;
  }
}

function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;
  realtimeRefreshTimer = setTimeout(() => {
    realtimeRefreshTimer = null;
    loadApplications();
    if (selectedApplicationId && selectedApplication) refreshSelectedConversation(selectedApplication);
  }, 150);
}

async function ensureRealtimeChannel() {
  if (adminChannel) return;

  adminChannel = supabase
    .channel("admin-inbox")
    .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, scheduleRealtimeRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      if (payload.new && payload.new.application_id === selectedApplicationId && selectedApplication) {
        refreshSelectedConversation(selectedApplication);
      }
      scheduleRealtimeRefresh();
    })
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Admin realtime unavailable:", error || status);
      }
    });
}

async function checkAdmin() {
  if (authCheckPromise) return authCheckPromise;

  authCheckPromise = (async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      await removeRealtimeChannel();
      showLogin();
      return false;
    }

    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      await removeRealtimeChannel();
      await supabase.auth.signOut({ scope: "local" });
      loginStatus.className = "status error";
      loginStatus.textContent = "This account is not authorized as an admin.";
      showLogin();
      return false;
    }

    showDashboard();
    await ensureRealtimeChannel();
    await loadApplications({ resetPage: true });
    return true;
  })();

  try {
    return await authCheckPromise;
  } finally {
    authCheckPromise = null;
  }
}

async function fetchApplications() {
  const from = currentPage * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("applications")
    .select("id, application_number, name, last_name, email, mobile_number, status, created_at, last_activity_at", { count: "exact" })
    .order("last_activity_at", { ascending: false })
    .range(from, to);

  const search = String(searchInput.value || "").trim().replace(/[^a-zA-Z0-9@.+ -]/g, "").slice(0, 80);
  const status = statusFilter.value;

  if (search) {
    const pattern = "*" + search.replace(/[*%_]/g, "") + "*";
    query = query.or(
      "application_number.ilike." + pattern +
      ",name.ilike." + pattern +
      ",last_name.ilike." + pattern +
      ",mobile_number.ilike." + pattern +
      ",email.ilike." + pattern
    );
  }

  if (status) query = query.eq("status", status);

  const { data, error, count: total } = await query;
  if (error) throw error;

  return { data: data || [], total: total || 0 };
}

function renderApplicationList() {
  count.textContent = totalApplicationCount;
  applicationList.innerHTML = applications.length
    ? applications.map((application) =>
        '<div class="application ' + (application.id === selectedApplicationId ? "active" : "") + '" data-id="' + escapeHtml(application.id) + '">' +
          '<strong>' + escapeHtml(application.application_number) + '</strong>' +
          '<small>' + escapeHtml([application.name, application.last_name].filter(Boolean).join(" ")) + " · " + escapeHtml(formatDate(application.last_activity_at)) + '</small>' +
          '<span class="badge">' + escapeHtml(formatStatus(application.status)) + '</span>' +
        '</div>'
      ).join("")
    : '<div class="empty list-empty">No applications match the current filters.</div>';

  applicationList.querySelectorAll(".application").forEach((element) => {
    element.addEventListener("click", () => openApplication(element.dataset.id));
  });

  const totalPages = Math.max(1, Math.ceil(totalApplicationCount / PAGE_SIZE));
  pageLabel.textContent = "Page " + (currentPage + 1) + " of " + totalPages;
  previousPageButton.disabled = currentPage === 0;
  nextPageButton.disabled = currentPage >= totalPages - 1;
}

async function loadApplications({ resetPage = false } = {}) {
  if (resetPage) currentPage = 0;
  const requestId = ++loadSequence;

  try {
    const result = await fetchApplications();
    if (requestId !== loadSequence) return;

    applications = result.data;
    totalApplicationCount = result.total;
    renderApplicationList();

    if (selectedApplicationId) {
      const selectedOnPage = applications.find((item) => item.id === selectedApplicationId);
      if (selectedOnPage) {
        selectedApplication = selectedOnPage;
        await refreshSelectedConversation(selectedOnPage);
      }
    }
  } catch (error) {
    if (requestId !== loadSequence) return;
    detail.innerHTML = '<div class="status error">Unable to load applications: ' + escapeHtml(error.message) + '</div>';
  }
}

async function fetchMessages(applicationId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_type, message, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function refreshSelectedConversation(application) {
  if (!application || application.id !== selectedApplicationId) return;

  try {
    const messages = await fetchMessages(application.id);
    if (application.id !== selectedApplicationId) return;
    renderDetail(application, messages, false);
  } catch (error) {
    const status = document.querySelector("#replyStatus");
    if (status) {
      status.className = "status error";
      status.textContent = error.message;
    }
  }
}

async function openApplication(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application) return;

  selectedApplicationId = applicationId;
  selectedApplication = application;
  renderApplicationList();
  detail.classList.add("loading");

  try {
    const messages = await fetchMessages(applicationId);
    if (selectedApplicationId !== applicationId) return;
    renderDetail(application, messages, true);
    requestAnimationFrame(() => scrollDetailMessages(false));
  } catch (error) {
    detail.innerHTML = '<div class="status error">' + escapeHtml(error.message) + '</div>';
  } finally {
    detail.classList.remove("loading");
  }
}

async function deleteApplication() {
  const application = selectedApplication;
  if (!application || application.id !== selectedApplicationId) return;

  const confirmed = window.confirm(
    "Delete application " + application.application_number +
    " permanently?\n\nThis will also delete its entire conversation. This action cannot be undone."
  );
  if (!confirmed) return;

  const button = document.querySelector("#deleteApplicationButton");
  button.disabled = true;
  button.textContent = "Deleting...";

  const { error } = await supabase.from("applications").delete().eq("id", application.id);
  if (error) {
    button.disabled = false;
    button.textContent = "Delete Application";
    window.alert("Unable to delete application: " + error.message);
    return;
  }

  selectedApplicationId = null;
  selectedApplication = null;
  selectedMessages = [];
  detail.innerHTML = '<div class="empty">Application deleted successfully.</div>';
  await loadApplications();
}

async function sendAdminReply(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button");
  const status = document.querySelector("#replyStatus");
  const message = String(new FormData(form).get("message") || "").trim();

  if (!selectedApplication || !message) return;

  button.disabled = true;
  status.className = "status";
  status.textContent = "Sending...";

  const { error } = await supabase.from("messages").insert({
    application_id: selectedApplication.id,
    sender_type: "admin",
    message,
  });

  if (error) {
    status.className = "status error";
    status.textContent = error.message;
  } else {
    form.reset();
    autoGrowTextarea(form.elements.message);
    status.className = "status success";
    status.textContent = "Reply sent.";
    await refreshSelectedConversation(selectedApplication);
    await loadApplications();
    setTimeout(() => {
      if (document.querySelector("#replyStatus") === status) status.textContent = "";
    }, 1800);
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
    loginStatus.textContent = "";
  }

  button.disabled = false;
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await removeRealtimeChannel();
  await supabase.auth.signOut({ scope: "local" });
  selectedApplicationId = null;
  selectedApplication = null;
  showLogin();
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadApplications({ resetPage: true }), 250);
});

statusFilter.addEventListener("change", () => loadApplications({ resetPage: true }));

previousPageButton.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage -= 1;
    loadApplications();
  }
});

nextPageButton.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(totalApplicationCount / PAGE_SIZE));
  if (currentPage < totalPages - 1) {
    currentPage += 1;
    loadApplications();
  }
});

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    void removeRealtimeChannel();
    showLogin();
  } else if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    void checkAdmin();
  }
});

void checkAdmin();
