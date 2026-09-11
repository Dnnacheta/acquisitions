/* global document, sessionStorage */
const root = document.getElementById("app");
const dialog = document.getElementById("record-dialog");
const stageNames = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};
const state = {
  token: sessionStorage.getItem("acquisitions.token"),
  user: null,
  view: "overview",
  page: 1,
  search: "",
  filter: "",
  records: [],
  total: 0,
  hasMore: false,
  requestId: 0,
};
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
  lead: '<path d="m13 2-9 12h7l-1 8 10-13h-8z"/>',
  board:
    '<rect x="3" y="4" width="5" height="15" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
  settings:
    '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  logout: '<path d="M9 3H4v18h5M9 12h12m-5-5 5 5-5 5"/>',
  edit: '<path d="m4 16-1 5 5-1L21 7l-4-4zM14 6l4 4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  money:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9v6m14-6v6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = name =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const money = value =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: Number(value) % 1 ? 2 : 0,
  }).format(Number(value) || 0);
const responsiveMoney = value =>
  `<span class="full-money">${money(value)}</span><span class="compact-money" title="${money(value)}" aria-label="${money(value)}">${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0)}</span>`;
const initials = name =>
  esc(
    (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join("")
      .toUpperCase(),
  );
const date = value =>
  value
    ? new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("en-NG", {
        day: "numeric",
        month: "short",
      })
    : "Not scheduled";
const pill = value =>
  `<span class="pill ${esc(value)}">${esc(stageNames[value] || value)}</span>`;
const brand =
  '<div class="brand"><span class="brand-mark">a</span>acquisitions<span aria-hidden="true">.</span></div>';
let toastTimer;
function toast(message) {
  const target = document.getElementById("toast");
  target.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    target.textContent = "";
  }, 4500);
}
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
  };
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Please try again.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      clearSession();
      renderAuth();
    }
    throw new Error(
      data.errors
        ?.map(error => `${error.field}: ${error.message}`)
        .join(" · ") ||
        data.message ||
        "Please try again.",
    );
  }
  return data;
}
function clearSession() {
  state.token = null;
  state.user = null;
  state.requestId++;
  sessionStorage.removeItem("acquisitions.token");
  dialog.close();
}
function renderAuth(mode = "signin") {
  const signup = mode === "signup",
    forgot = mode === "forgot";
  root.innerHTML = `<div class="auth"><section class="auth-story">${brand}<div><span class="eyebrow">A LITTLE MORE HUMAN. A LOT MORE CONNECTED.</span><h1>Good relationships.<br><em>Great possibilities.</em></h1><p>A thoughtful space for your customers, your conversations, and the opportunities ahead.</p></div><div class="auth-steps"><span><b>01</b>Connect</span><span><b>02</b>Nurture</span><span><b>03</b>Grow</span></div></section><section class="auth-panel"><div class="auth-panel-inner"><span class="eyebrow">YOUR RELATIONSHIP WORKSPACE</span><h2>${signup ? "Make room for growth." : forgot ? "Let’s get you back in." : "Welcome back."}</h2><p>${signup ? "Create your account and bring your next opportunity closer." : forgot ? "We’ll send a password reset link if your account is eligible." : "Your customers, your pipeline, your next big thing."}</p><form id="auth-form">${signup ? field("name", "Your name", "", "text", 'required autocomplete="name"') : ""}${field("email", "Email address", "", "email", 'required autocomplete="email"')}${!forgot ? field("password", "Password", "", "password", `required minlength="${signup ? 8 : 1}" maxlength="128" autocomplete="${signup ? "new-password" : "current-password"}"`) : ""}${!signup && !forgot ? '<button type="button" class="forgot" data-auth="forgot">Forgot password?</button>' : ""}<div class="error" role="alert"></div><button class="btn primary" type="submit">${signup ? "Create account" : forgot ? "Send reset link" : "Sign in to your workspace"}${icon("arrow")}</button></form><div class="auth-switch">${signup || forgot ? '<button data-auth="signin">Back to sign in</button>' : '<span class="muted">New here?</span> <button data-auth="signup">Create an account</button>'}</div></div></section></div>`;
  document
    .querySelectorAll("[data-auth]")
    .forEach(button =>
      button.addEventListener("click", () => renderAuth(button.dataset.auth)),
    );
  document
    .getElementById("auth-form")
    .addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget,
        button = form.querySelector('[type="submit"]');
      button.disabled = true;
      form.querySelector(".error").textContent = "";
      try {
        const data = await api(
          `/auth/${signup ? "sign-up" : forgot ? "forgot-password" : "sign-in"}`,
          { method: "POST", body: Object.fromEntries(new FormData(form)) },
        );
        if (forgot) {
          form.innerHTML = `<p class="form-success" role="status">${esc(data.message)} Check your inbox for the next step.</p>`;
          return;
        }
        state.token = data.token;
        state.user = data.user;
        sessionStorage.setItem("acquisitions.token", state.token);
        state.view = "overview";
        renderShell();
        await loadView();
      } catch (error) {
        form.querySelector(".error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
}
function field(
  name,
  label,
  value = "",
  type = "text",
  attributes = "",
  full = false,
) {
  return `<label class="field${full ? " full" : ""}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
}
function renderShell() {
  const titles = {
    overview: "Overview",
    customers: "Customers",
    leads: "Leads",
    pipeline: "Pipeline",
    settings: "My account",
    team: "Team",
  };
  root.innerHTML = `<div class="workspace"><aside class="sidebar">${brand}<span class="eyebrow">WORKSPACE</span><nav class="nav" aria-label="Main navigation">${[
    ["overview", "grid"],
    ["customers", "people"],
    ["leads", "lead"],
    ["pipeline", "board"],
  ]
    .map(
      ([view, symbol]) =>
        `<button data-view="${view}" class="${state.view === view ? "selected" : ""}">${icon(symbol)}${titles[view]}</button>`,
    )
    .join(
      "",
    )}</nav><div class="nav-divider"></div><span class="eyebrow">MANAGE</span><nav class="nav" aria-label="Account navigation"><button data-view="settings" class="${state.view === "settings" ? "selected" : ""}">${icon("settings")}My account</button>${state.user.role === "admin" ? `<button data-view="team" class="${state.view === "team" ? "selected" : ""}">${icon("people")}Team</button>` : ""}</nav><div class="sidebar-bottom"><div class="sidebar-note"><strong>A little follow-up goes a long way.</strong><p>Make your next conversation count. Your pipeline is a good place to start.</p></div><div class="identity"><span class="avatar">${initials(state.user.name)}</span><div><strong>${esc(state.user.name)}</strong><small>${state.user.role === "admin" ? "Administrator" : "Sales workspace"}</small></div><button id="signout" aria-label="Sign out" title="Sign out">${icon("logout")}</button></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumbs"><button class="mobile-menu" aria-label="Toggle navigation">${icon("menu")}</button><span>Workspace</span><span>/</span><strong>${titles[state.view]}</strong></div><div class="top-meta"><span class="scope">${state.user.role === "admin" ? "All team records" : "My records"}</span><span>${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span><span class="avatar">${initials(state.user.name)}</span></div></header><div class="content" id="content"></div></main></div>`;
  document
    .querySelectorAll("[data-view]")
    .forEach(button =>
      button.addEventListener("click", () => navigate(button.dataset.view)),
    );
  document
    .querySelector(".mobile-menu")
    .addEventListener("click", () =>
      document.querySelector(".sidebar").classList.toggle("open"),
    );
  document.getElementById("signout").addEventListener("click", async () => {
    try {
      await api("/auth/sign-out", { method: "POST" });
    } catch {
      /* Local logout must still succeed. */
    }
    clearSession();
    renderAuth();
  });
}
async function navigate(view) {
  state.view = view;
  state.page = 1;
  state.search = "";
  state.filter = "";
  state.records = [];
  renderShell();
  await loadView();
}
function heading(title, subtitle, action = "", label = "WORKSPACE") {
  return `<section class="page-heading"><div><span class="eyebrow">${label}</span><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</section>`;
}
const addButton = resource =>
  `<button class="btn primary" data-create="${resource}">${icon("plus")}Add ${resource === "customers" ? "customer" : "lead"}</button>`;
function empty(title, description, resource) {
  return `<div class="empty">${icon(resource === "customers" ? "people" : "lead")}<strong>${title}</strong>${description}${resource ? `<div>${addButton(resource)}</div>` : ""}</div>`;
}
async function loadView(append = false) {
  const requestId = ++state.requestId;
  const content = document.getElementById("content");
  if (!append)
    content.innerHTML =
      '<div class="loading" role="status">Getting your workspace ready…</div>';
  try {
    if (state.view === "overview") {
      const data = await api("/crm/overview");
      if (requestId !== state.requestId) return;
      renderOverview(content, data);
    } else if (state.view === "settings") {
      renderSettings(content);
    } else if (state.view === "team") {
      const data = await api(`/users?page=${state.page}&limit=20`);
      if (requestId !== state.requestId) return;
      renderTeam(content, data);
    } else {
      const resource = state.view === "customers" ? "customers" : "leads";
      const query = new URLSearchParams({
        page: String(state.page),
        limit: state.view === "pipeline" ? "100" : "20",
        search: state.search,
      });
      if (state.filter)
        query.set(resource === "customers" ? "status" : "stage", state.filter);
      const data = await api(`/crm/${resource}?${query}`);
      if (requestId !== state.requestId) return;
      state.records = append
        ? [...state.records, ...data[resource]]
        : data[resource];
      state.total = data.total;
      state.hasMore = data.hasMore;
      if (state.view === "pipeline") renderPipeline(content);
      else renderList(content, resource);
    }
    bindContent(content);
  } catch (error) {
    if (requestId !== state.requestId) return;
    content.innerHTML = `<div class="card page-error" role="alert">${esc(error.message)} <button class="btn small" id="retry">Try again</button></div>`;
    document
      .getElementById("retry")
      .addEventListener("click", () => loadView());
  }
}
function renderOverview(content, data) {
  const total = data.pipeline.reduce((sum, stage) => sum + stage.count, 0);
  const open = data.pipeline.filter(
    stage => !["won", "lost"].includes(stage.stage),
  );
  const openValue = open.reduce((sum, stage) => sum + Number(stage.value), 0);
  const won = data.pipeline.find(stage => stage.stage === "won") || {
    count: 0,
    value: 0,
  };
  const max = Math.max(1, ...data.pipeline.map(stage => stage.count));
  const metrics = [
    [
      "Total customers",
      data.customers,
      "Relationships in your workspace",
      "people",
    ],
    [
      "Open leads",
      open.reduce((sum, stage) => sum + stage.count, 0),
      "Opportunities in progress",
      "lead",
    ],
    [
      "Pipeline value",
      responsiveMoney(openValue),
      "Open opportunities · NGN",
      "money",
    ],
    [
      "Deals won",
      won.count,
      `${money(won.value)} in won opportunities`,
      "check",
    ],
  ];
  content.innerHTML =
    heading(
      `Let’s make connections, ${esc(state.user.name.split(" ")[0])}.`,
      "A little clarity for your day. Here’s where your relationships stand.",
      `<button class="btn" data-view="pipeline">${icon("board")}View pipeline</button>${addButton("leads")}`,
      "YOUR WORKSPACE, AT A GLANCE",
    ) +
    `<div class="metrics">${metrics.map(([label, value, detail, symbol]) => `<section class="card metric"><div class="metric-top">${label}<span class="metric-icon">${icon(symbol)}</span></div><div class="metric-value">${value}</div><div class="metric-bottom">${esc(detail)}</div></section>`).join("")}</div><div class="dashboard-grid"><section class="card"><div class="card-head"><div><h2>Your sales pipeline</h2><p>Every conversation, a step closer.</p></div><span class="pill">${total} leads</span></div><div class="pipeline-chart">${Object.entries(
      stageNames,
    )
      .map(([stage, label]) => {
        const count =
          data.pipeline.find(row => row.stage === stage)?.count || 0;
        return `<div class="stage-row"><span>${label}</span><div class="track"><div class="bar" style="width:${(count / max) * 100}%"></div></div><strong>${count}</strong></div>`;
      })
      .join(
        "",
      )}</div><div class="chart-footer"><span>Open pipeline value</span><strong>${money(openValue)}</strong></div></section><section class="card"><div class="card-head"><div><h2>Next conversations</h2><p>Keep the good things moving.</p></div>${icon("calendar")}</div>${data.followUps.length ? data.followUps.map(lead => `<button class="follow-item" data-edit="leads" data-id="${lead.id}"><span class="date-box"><b>${Number(lead.followUpDate.slice(8))}</b>${new Date(lead.followUpDate + "T12:00:00").toLocaleDateString("en", { month: "short" })}</span><div><strong>${esc(lead.title)}</strong><small>${esc(lead.company || lead.contactName || "Sales follow-up")}<br>${date(lead.followUpDate)}</small></div></button>`).join("") : empty("Room for your next conversation", "Add a follow-up date to a lead and find it here.")}</section></div><section class="card recent"><div class="card-head"><div><h2>Recently updated leads</h2><p>The latest movement in your workspace.</p></div><button class="btn text small" data-view="leads">View all leads ${icon("arrow")}</button></div>${data.recentLeads.length ? leadTable(data.recentLeads) : empty("Your next opportunity belongs here", "Add your first lead to start building your pipeline.", "leads")}</section><p class="footer-note">Built for meaningful relationships. All values in NGN.</p>`;
}
function leadTable(records) {
  return `<div class="table-wrap"><table><thead><tr><th>Opportunity</th><th>Company</th><th>Value</th><th>Stage</th><th>Follow-up</th><th><span class="muted">Actions</span></th></tr></thead><tbody>${records.map(lead => `<tr><td><div class="person"><span class="avatar lilac">${initials(lead.title)}</span><div><button class="link" data-edit="leads" data-id="${lead.id}">${esc(lead.title)}</button><small>${esc(lead.contactName || lead.email || "No contact yet")}</small></div></div></td><td>${esc(lead.company || "—")}</td><td><strong>${money(lead.value)}</strong></td><td>${pill(lead.stage)}</td><td>${date(lead.followUpDate)}</td><td>${actions("leads", lead)}</td></tr>`).join("")}</tbody></table></div>`;
}
function actions(resource, record) {
  return `<div class="table-actions"><button data-edit="${resource}" data-id="${record.id}" aria-label="Edit ${esc(record.name || record.title)}">${icon("edit")}</button><button data-delete="${resource}" data-id="${record.id}" aria-label="Delete ${esc(record.name || record.title)}">${icon("trash")}</button></div>`;
}
function renderList(content, resource) {
  const customer = resource === "customers";
  content.innerHTML =
    heading(
      customer
        ? "Good people. Great relationships."
        : "Big things start with a hello.",
      customer
        ? "A home for every customer and every detail that matters."
        : "Capture opportunities and give every conversation a next step.",
      addButton(resource),
      customer ? "YOUR CUSTOMERS" : "YOUR OPPORTUNITIES",
    ) +
    `<section class="card"><div class="toolbar"><form class="search-form" id="search-form"><label class="search">${icon("search")}<input name="search" aria-label="Search ${resource}" placeholder="Search ${resource}…" value="${esc(state.search)}" maxlength="100"></label><button class="btn small">Search</button></form><select id="list-filter" aria-label="Filter ${customer ? "status" : "stage"}"><option value="">All ${customer ? "statuses" : "stages"}</option>${Object.entries(
      customer ? { active: "Active", inactive: "Inactive" } : stageNames,
    )
      .map(
        ([value, label]) =>
          `<option value="${value}" ${value === state.filter ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div>${state.records.length ? (customer ? `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Company</th><th>Phone</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead><tbody>${state.records.map(record => `<tr><td><div class="person"><span class="avatar">${initials(record.name)}</span><div><button class="link" data-edit="customers" data-id="${record.id}">${esc(record.name)}</button><small>${esc(record.email)}</small></div></div></td><td>${esc(record.company || "—")}</td><td>${esc(record.phone || "—")}</td><td>${pill(record.status)}</td><td>${date(record.createdAt)}</td><td>${actions("customers", record)}</td></tr>`).join("")}</tbody></table></div>` : leadTable(state.records)) : empty(state.search || state.filter ? "No matches this time" : `Your ${resource} start here`, state.search || state.filter ? "Try a different search or filter." : `Add your first ${customer ? "customer" : "lead"} to get started.`, resource)}${pagination(state.total, state.hasMore)}</section>`;
}
function pagination(total, hasMore) {
  return `<div class="pagination"><span>${total === null ? `Page ${state.page}` : `${total} ${total === 1 ? "record" : "records"} · Page ${state.page}`}</span><div><button class="btn small" data-page="-1" ${state.page === 1 ? "disabled" : ""}>Previous</button><button class="btn small" data-page="1" ${hasMore ? "" : "disabled"}>Next</button></div></div>`;
}
function renderPipeline(content) {
  content.innerHTML =
    heading(
      "A clear path to your next win.",
      "Move each opportunity forward, one good conversation at a time.",
      addButton("leads"),
      "SALES PIPELINE",
    ) +
    `<div class="board-actions"><span>Showing ${state.records.length} of ${state.total} leads · Values in NGN</span>${state.hasMore ? '<button class="btn small" id="load-more">Load more leads</button>' : ""}</div><div class="board">${Object.entries(
      stageNames,
    )
      .map(([stage, label]) => {
        const records = state.records.filter(lead => lead.stage === stage);
        return `<section class="column"><div class="column-head"><strong>${label}</strong><span>${records.length}</span></div><div class="column-total">${money(records.reduce((sum, lead) => sum + Number(lead.value), 0))} · loaded leads</div>${
          records.length
            ? records
                .map(
                  lead =>
                    `<article class="lead-card"><h3><button class="link" data-edit="leads" data-id="${lead.id}">${esc(lead.title)}</button></h3><p>${esc(lead.company || lead.contactName || "No company yet")}</p><div class="card-bottom"><strong>${money(lead.value)}</strong><span class="avatar">${initials(lead.contactName || lead.title)}</span></div><select data-stage-id="${lead.id}" aria-label="Stage for ${esc(lead.title)}">${Object.entries(
                      stageNames,
                    )
                      .map(
                        ([value, name]) =>
                          `<option value="${value}" ${value === stage ? "selected" : ""}>${name}</option>`,
                      )
                      .join("")}</select></article>`,
                )
                .join("")
            : '<div class="column-empty">A little room to grow.</div>'
        }</section>`;
      })
      .join("")}</div>`;
}
function bindContent(content) {
  content
    .querySelectorAll("[data-view]")
    .forEach(button =>
      button.addEventListener("click", () => navigate(button.dataset.view)),
    );
  content
    .querySelectorAll("[data-create]")
    .forEach(button =>
      button.addEventListener("click", () => openRecord(button.dataset.create)),
    );
  content
    .querySelectorAll("[data-edit]")
    .forEach(button =>
      button.addEventListener("click", () =>
        openRecord(button.dataset.edit, button.dataset.id),
      ),
    );
  content
    .querySelectorAll("[data-delete]")
    .forEach(button =>
      button.addEventListener("click", () =>
        confirmDelete(button.dataset.delete, button.dataset.id),
      ),
    );
  content.querySelectorAll("[data-page]").forEach(button =>
    button.addEventListener("click", () => {
      state.page += Number(button.dataset.page);
      loadView();
    }),
  );
  content.querySelector("#search-form")?.addEventListener("submit", event => {
    event.preventDefault();
    state.search = new FormData(event.currentTarget).get("search").trim();
    state.page = 1;
    loadView();
  });
  content.querySelector("#list-filter")?.addEventListener("change", event => {
    state.filter = event.target.value;
    state.page = 1;
    loadView();
  });
  content.querySelector("#load-more")?.addEventListener("click", () => {
    state.page++;
    loadView(true);
  });
  content.querySelectorAll("[data-stage-id]").forEach(select =>
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        const data = await api(`/crm/leads/${select.dataset.stageId}`, {
          method: "PATCH",
          body: { stage: select.value },
        });
        const index = state.records.findIndex(
          lead => lead.id === data.record.id,
        );
        state.records[index] = data.record;
        renderPipeline(content);
        bindContent(content);
        toast("Lead moved to " + stageNames[data.record.stage]);
      } catch (error) {
        select.value = state.records.find(
          lead => lead.id === Number(select.dataset.stageId),
        ).stage;
        toast(error.message);
      } finally {
        select.disabled = false;
      }
    }),
  );
}
async function openRecord(resource, id) {
  dialog.innerHTML = '<p class="loading">Opening record…</p>';
  dialog.showModal();
  try {
    const record = id ? (await api(`/crm/${resource}/${id}`)).record : {};
    if (!dialog.open) return;
    const customer = resource === "customers";
    const fields = customer
      ? `${field("name", "Customer name", record.name, "text", 'required maxlength="255"')}${field("email", "Email address", record.email, "email", 'required maxlength="255"')}${field("company", "Company", record.company, "text", 'maxlength="255"')}${field("phone", "Phone", record.phone, "tel", 'maxlength="50"')}<label class="field full">Status<select name="status">${["active", "inactive"].map(value => `<option ${record.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>`
      : `${field("title", "Opportunity name", record.title, "text", 'required maxlength="255"', true)}${field("contactName", "Contact name", record.contactName, "text", 'maxlength="255"')}${field("email", "Contact email", record.email, "email", 'maxlength="255"')}${field("company", "Company", record.company, "text", 'maxlength="255"')}${field("source", "Lead source", record.source || "Website", "text", 'maxlength="100"')}${field("value", "Estimated value (NGN)", record.value ?? 0, "number", 'required min="0" max="99999999999" step="0.01"')}<label class="field">Stage<select name="stage">${Object.entries(
          stageNames,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}" ${record.stage === value ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label>${field("followUpDate", "Next follow-up", record.followUpDate, "date")}<label class="field">Linked customer<select name="customerId" id="customer-picker"><option value="">No linked customer</option></select></label><label class="field full">Find a customer<input id="customer-search" placeholder="Search customer name or company" maxlength="100"><small id="customer-hint">Only customers owned by this opportunity’s salesperson can be linked.</small></label>`;
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${id ? "Edit" : "Add"} ${customer ? "customer" : "lead"}</h2><button class="close" aria-label="Close dialog">×</button></div><form id="record-form"><div class="form-grid">${fields}<label class="field full">Notes<textarea name="notes" maxlength="5000" placeholder="The details worth remembering…">${esc(record.notes)}</textarea></label></div><div class="error" role="alert"></div><div class="form-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">${id ? "Save changes" : `Create ${customer ? "customer" : "lead"}`}</button></div></form>`;
    dialog
      .querySelector(".close")
      .addEventListener("click", () => dialog.close());
    dialog
      .querySelector("[data-cancel]")
      .addEventListener("click", () => dialog.close());
    if (!customer) {
      let searchGeneration = 0;
      let firstCustomerSearch = true;
      const populateCustomers = async search => {
        const generation = ++searchGeneration;
        const picker = dialog.querySelector("#customer-picker");
        const selected = firstCustomerSearch ? record.customerId : picker.value;
        firstCustomerSearch = false;
        try {
          const data = await api(
            `/crm/customers?limit=100&search=${encodeURIComponent(search)}`,
          );
          if (generation !== searchGeneration || !dialog.open) return;
          const ownerId =
            record.ownerId === undefined ? state.user.id : record.ownerId;
          const options = data.customers.filter(
            item => item.ownerId === ownerId,
          );
          if (selected && !options.some(item => item.id === Number(selected))) {
            const current = (await api(`/crm/customers/${selected}`)).record;
            if (current.ownerId === ownerId) options.unshift(current);
          }
          if (generation !== searchGeneration || !dialog.open) return;
          picker.innerHTML =
            '<option value="">No linked customer</option>' +
            options
              .map(
                item =>
                  `<option value="${item.id}" ${item.id === Number(selected) ? "selected" : ""}>${esc(item.name)}${item.company ? ` · ${esc(item.company)}` : ""}</option>`,
              )
              .join("");
          dialog.querySelector("#customer-hint").textContent = data.hasMore
            ? "More customers available. Refine the search to find a match."
            : "Customers owned by this opportunity’s salesperson.";
        } catch (error) {
          if (dialog.open)
            dialog.querySelector(".error").textContent = error.message;
        }
      };
      await populateCustomers("");
      let timer;
      dialog
        .querySelector("#customer-search")
        ?.addEventListener("input", event => {
          clearTimeout(timer);
          timer = setTimeout(() => populateCustomers(event.target.value), 350);
        });
    }
    const form = dialog.querySelector("#record-form");
    if (!form) return;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      const body = Object.fromEntries(new FormData(form));
      if (!customer) {
        body.value = Number(body.value);
        body.customerId = body.customerId ? Number(body.customerId) : null;
        body.followUpDate = body.followUpDate || null;
      }
      try {
        await api(`/crm/${resource}${id ? `/${id}` : ""}`, {
          method: id ? "PATCH" : "POST",
          body,
        });
        dialog.close();
        toast(
          id ? "Changes saved" : `${customer ? "Customer" : "Lead"} created`,
        );
        state.page = 1;
        await loadView();
      } catch (error) {
        form.querySelector(".error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    dialog.querySelector("input")?.focus();
  } catch (error) {
    dialog.innerHTML = `<div class="error" role="alert">${esc(error.message)}</div><button class="btn" data-cancel>Close</button>`;
    dialog
      .querySelector("[data-cancel]")
      .addEventListener("click", () => dialog.close());
  }
}
function confirmDelete(resource, id) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">Delete this ${resource === "customers" ? "customer" : "lead"}?</h2></div><p class="confirm-copy">This permanently removes the record.${resource === "customers" ? " Linked leads will be kept, with their customer link removed." : ""} This cannot be undone.</p><div class="error" role="alert"></div><div class="form-actions"><button class="btn" data-cancel>Keep record</button><button class="btn danger" id="confirm-delete">Delete record</button></div>`;
  dialog.showModal();
  dialog.querySelector("[data-cancel]").focus();
  dialog
    .querySelector("[data-cancel]")
    .addEventListener("click", () => dialog.close());
  dialog
    .querySelector("#confirm-delete")
    .addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api(`/crm/${resource}/${id}`, { method: "DELETE" });
        dialog.close();
        toast("Record deleted");
        state.page = 1;
        await loadView();
      } catch (error) {
        dialog.querySelector(".error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
}
function renderSettings(content) {
  content.innerHTML =
    heading(
      "Make yourself at home.",
      "Your profile and account details.",
      "",
      "MY ACCOUNT",
    ) +
    `<section class="card settings"><h2>Profile details</h2><form id="profile-form"><div class="form-grid">${field("name", "Your name", state.user.name, "text", "required")}${field("email", "Email address", state.user.email, "email", "required")}${field("currentPassword", "Current password", "", "password", 'autocomplete="current-password"')}${field("password", "New password (optional)", "", "password", 'minlength="8" maxlength="128" autocomplete="new-password"')}</div><p class="settings-note">Enter your current password when changing your email or password.</p><div class="error" role="alert"></div><button class="btn primary">Save profile</button></form><div class="nav-divider"></div><h2>Email verification</h2><p class="settings-note">${state.user.emailVerifiedAt ? "Your email address is verified." : "Confirm your email address to keep your account details up to date."}</p>${state.user.emailVerifiedAt ? pill("active") : '<button class="btn" id="verify-request">Send verification email</button>'}</section>`;
  document
    .getElementById("profile-form")
    .addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget,
        button = form.querySelector("button");
      button.disabled = true;
      const body = Object.fromEntries(new FormData(form));
      if (!body.password) delete body.password;
      if (!body.currentPassword) delete body.currentPassword;
      try {
        const data = await api("/users/me", { method: "PATCH", body });
        state.user = data.user;
        renderShell();
        await loadView();
        toast("Profile updated");
      } catch (error) {
        form.querySelector(".error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  document
    .getElementById("verify-request")
    ?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const data = await api("/auth/request-email-verification", {
          method: "POST",
          body: { email: state.user.email },
        });
        toast(data.message);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    });
}
function renderTeam(content, data) {
  content.innerHTML =
    heading(
      "The people behind the progress.",
      "View your team and manage access to this workspace.",
      "",
      "TEAM",
    ) +
    `<section class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Access</th></tr></thead><tbody>${data.users.map(user => `<tr><td><strong>${esc(user.name)}</strong></td><td>${esc(user.email)}</td><td>${esc(user.role)}</td><td>${date(user.createdAt)}</td><td>${user.id === state.user.id ? "Your account" : `<button class="btn small" data-role-id="${user.id}" data-role="${user.role === "admin" ? "user" : "admin"}">${user.role === "admin" ? "Make user" : "Make admin"}</button>`}</td></tr>`).join("")}</tbody></table></div>${pagination(null, data.hasMore)}</section>`;
  content.querySelectorAll("[data-role-id]").forEach(button =>
    button.addEventListener("click", () => {
      dialog.innerHTML = `<h2 id="dialog-title">Change account role?</h2><p class="confirm-copy">${button.dataset.role === "admin" ? "Administrators can view and manage all customer, lead, and user records." : "This user will only be able to manage their own customer and lead records."}</p><div class="error" role="alert"></div><div class="form-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" id="confirm-role">Confirm change</button></div>`;
      dialog.showModal();
      dialog
        .querySelector("[data-cancel]")
        .addEventListener("click", () => dialog.close());
      dialog
        .querySelector("#confirm-role")
        .addEventListener("click", async event => {
          event.currentTarget.disabled = true;
          try {
            await api(`/users/${button.dataset.roleId}`, {
              method: "PATCH",
              body: { role: button.dataset.role },
            });
            dialog.close();
            toast("Role updated");
            await loadView();
          } catch (error) {
            dialog.querySelector(".error").textContent = error.message;
            event.target.disabled = false;
          }
        });
    }),
  );
}
async function start() {
  if (!state.token) {
    renderAuth();
    return;
  }
  try {
    state.user = (await api("/users/me")).user;
    renderShell();
    await loadView();
  } catch {
    clearSession();
    renderAuth();
    toast("Please sign in to continue.");
  }
}
start();
