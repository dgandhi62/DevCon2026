/**
 * CDK Booth Feedback Wall — frontend.
 *
 * Talks to the API Gateway endpoint that fronts the reactions Lambda:
 *   GET  {API_BASE}/reactions        -> { reactions: [...] }
 *   POST {API_BASE}/reactions        -> { reaction: {...} }
 *   POST {API_BASE}/reactions/{id}/upvote -> { reaction: {...} }
 *
 * The API base URL is injected at deploy time by the CDK BucketDeployment,
 * which writes a small config.js next to this file:  window.FEEDBACK_API = "..."
 *
 * If no API is configured (e.g. opening the file locally before deploy), the
 * wall runs in an in-memory DEMO MODE so it still looks alive at the booth.
 */
(function () {
  "use strict";

  var API_BASE = (window.FEEDBACK_API || "").replace(/\/+$/, "");
  var DEMO_MODE = !API_BASE;
  var POLL_MS = 5000;

  var MOODS = {
    fire: "🔥",
    mind: "🤯",
    love: "❤️",
    think: "🤔",
    rocket: "🚀",
  };

  // ---- element refs ----
  var els = {
    form: document.getElementById("reactionForm"),
    name: document.getElementById("nameInput"),
    message: document.getElementById("messageInput"),
    submit: document.getElementById("submitBtn"),
    error: document.getElementById("formError"),
    cards: document.getElementById("cards"),
    empty: document.getElementById("emptyState"),
    skeleton: document.getElementById("skeleton"),
    total: document.getElementById("totalCount"),
    refresh: document.getElementById("refreshBtn"),
    apiStatus: document.getElementById("apiStatus"),
    apiBadge: document.getElementById("apiBadge"),
    moods: Array.prototype.slice.call(document.querySelectorAll(".mood")),
  };

  var selectedMood = "fire";
  var knownIds = {}; // id -> true, to flag freshly-arrived cards

  // ---- mood picker ----
  els.moods.forEach(function (btn) {
    if (btn.dataset.mood === selectedMood) btn.classList.add("selected");
    btn.addEventListener("click", function () {
      selectedMood = btn.dataset.mood;
      els.moods.forEach(function (b) { b.classList.remove("selected"); });
      btn.classList.add("selected");
    });
  });

  // ---- API layer (with demo fallback) ----
  var demoStore = seedDemo();

  function listReactions() {
    if (DEMO_MODE) {
      return Promise.resolve({ list: sortReactions(demoStore.slice()), apiVersion: "demo" });
    }
    return fetch(API_BASE + "/reactions")
      .then(function (r) {
        if (!r.ok) throw new Error("GET failed: " + r.status);
        return r.json();
      })
      .then(function (data) {
        return { list: sortReactions(data.reactions || []), apiVersion: data.apiVersion };
      });
  }

  function createReaction(payload) {
    if (DEMO_MODE) {
      var reaction = {
        id: "demo-" + Date.now(),
        name: payload.name || "anon",
        message: payload.message,
        mood: payload.mood,
        votes: 0,
        createdAt: new Date().toISOString(),
      };
      demoStore.push(reaction);
      return Promise.resolve(reaction);
    }
    return fetch(API_BASE + "/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (!r.ok) throw new Error("POST failed: " + r.status);
      return r.json().then(function (d) { return d.reaction; });
    });
  }

  function upvoteReaction(id) {
    if (DEMO_MODE) {
      demoStore.forEach(function (x) { if (x.id === id) x.votes += 1; });
      return Promise.resolve();
    }
    return fetch(API_BASE + "/reactions/" + encodeURIComponent(id) + "/upvote", {
      method: "POST",
    }).then(function (r) {
      if (!r.ok) throw new Error("upvote failed: " + r.status);
    });
  }

  // ---- rendering ----
  function sortReactions(list) {
    // Most-voted first, then newest. Tabulated on the wall.
    return list.sort(function (a, b) {
      if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function render(list) {
    els.skeleton.hidden = true;
    els.total.textContent = String(list.length);

    if (!list.length) {
      els.cards.innerHTML = "";
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    els.cards.innerHTML = list
      .map(function (r) {
        var isNew = !knownIds[r.id];
        knownIds[r.id] = true;
        return cardHtml(r, isNew);
      })
      .join("");

    // wire upvote buttons
    Array.prototype.slice
      .call(els.cards.querySelectorAll(".upvote"))
      .forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.dataset.id;
          btn.disabled = true;
          upvoteReaction(id)
            .then(refresh)
            .catch(function () { btn.disabled = false; });
        });
      });
  }

  function cardHtml(r, isNew) {
    var emoji = MOODS[r.mood] || "💬";
    return (
      '<article class="card' + (isNew ? " is-new" : "") + '">' +
      '<div class="card-top">' +
      '<span class="card-emoji">' + emoji + "</span>" +
      '<span class="card-name">' + escapeHtml(r.name || "anon") + "</span>" +
      "</div>" +
      '<p class="card-msg">' + escapeHtml(r.message) + "</p>" +
      '<div class="card-foot">' +
      '<span class="card-time">' + timeAgo(r.createdAt) + "</span>" +
      '<button class="upvote" data-id="' + escapeAttr(r.id) + '">▲ <span>' + (r.votes || 0) + "</span></button>" +
      "</div>" +
      "</article>"
    );
  }

  // ---- flow ----
  var lastApiVersion = null;

  function refresh() {
    return listReactions()
      .then(function (res) {
        render(res.list);
        updateApiBadge(res.apiVersion);
        setStatus(DEMO_MODE ? "demo mode (no API configured)" : "live", DEMO_MODE ? "" : "ok");
      })
      .catch(function (err) {
        // Even on error, drop the loading skeleton so we don't leave grey
        // shimmering blocks that look like broken cards.
        if (els.skeleton) els.skeleton.hidden = true;
        setStatus("API error: " + err.message, "err");
      });
  }

  // Show the API version in the header badge. When it CHANGES (e.g. right after
  // a hotswap), briefly flash the badge so the audience sees the switch live.
  function updateApiBadge(version) {
    if (!els.apiBadge || !version) return;
    els.apiBadge.textContent = "api: " + version;
    if (lastApiVersion !== null && version !== lastApiVersion) {
      els.apiBadge.classList.remove("flash");
      // reflow so the animation restarts even if the class was just removed
      void els.apiBadge.offsetWidth;
      els.apiBadge.classList.add("flash");
    }
    lastApiVersion = version;
  }

  els.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var message = els.message.value.trim();
    if (!message) return showError("Say something first.");
    hideError();
    els.submit.disabled = true;

    createReaction({
      name: els.name.value.trim(),
      message: message,
      mood: selectedMood,
    })
      .then(function () {
        els.message.value = "";
        return refresh();
      })
      .catch(function (err) { showError("Could not post: " + err.message); })
      .then(function () { els.submit.disabled = false; });
  });

  els.refresh.addEventListener("click", refresh);

  // ---- helpers ----
  function setStatus(text, cls) {
    els.apiStatus.textContent = text;
    els.apiStatus.className = "api-status" + (cls ? " " + cls : "");
  }
  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
  }
  function hideError() {
    els.error.hidden = true;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
  function timeAgo(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "just now";
    var secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 10) return "just now";
    if (secs < 60) return secs + "s ago";
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }

  function seedDemo() {
    var now = Date.now();
    return [
      { id: "s1", name: "Priya", message: "Hotswap deployed my Lambda fix in 4 seconds. Wild.", mood: "rocket", votes: 12, createdAt: new Date(now - 240000).toISOString() },
      { id: "s2", name: "Marcus", message: "Synth validation caught my open S3 bucket before I wasted a deploy.", mood: "mind", votes: 9, createdAt: new Date(now - 500000).toISOString() },
      { id: "s3", name: "anon", message: "The synth-performance skill found my bottleneck instantly.", mood: "fire", votes: 7, createdAt: new Date(now - 90000).toISOString() },
      { id: "s4", name: "Lena", message: "Express mode deploy with no stabilization wait = chef's kiss", mood: "love", votes: 5, createdAt: new Date(now - 30000).toISOString() },
    ];
  }

  // ---- Session Insights panel ----
  // Rendered from window.SESSION_INSIGHTS, which the CDK BucketDeployment injects
  // into config.js at deploy time (precomputed at synth by SessionAnalytics).
  function renderInsights() {
    var grid = document.getElementById("insightsGrid");
    var count = document.getElementById("insightsCount");
    var tabCount = document.getElementById("tabSessionsCount");
    if (!grid) return;

    var insights = window.SESSION_INSIGHTS;
    if (DEMO_MODE && (!insights || !insights.length)) insights = seedInsights();
    insights = insights || [];

    if (count) count.textContent = String(insights.length);
    if (tabCount) tabCount.textContent = String(insights.length);

    if (!insights.length) {
      grid.innerHTML = '<p class="sessions-empty">No sessions in the catalog.</p>';
      return;
    }

    var maxCap = insights.reduce(function (m, s) {
      return Math.max(m, s.capacity || 0);
    }, 0) || 1;

    grid.innerHTML = insights
      .map(function (s) {
        var pct = Math.round(((s.capacity || 0) / maxCap) * 100);
        return (
          '<div class="session-card">' +
          '<span class="session-title">' + escapeHtml(s.title) + "</span>" +
          '<span class="session-track">' + escapeHtml(s.track) + "</span>" +
          '<div class="session-cap-row">' +
          '<div class="session-bar"><div class="session-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="session-cap">' + (s.capacity || 0) + "</span>" +
          "</div>" +
          '<span class="session-cap-label">capacity</span>' +
          "</div>"
        );
      })
      .join("");
  }

  function seedInsights() {
    // Local demo-mode fallback so the panel is populated when opened offline.
    return [
      { id: "s0", title: "Day 1: Keynote", track: "main", capacity: 400 },
      { id: "s1", title: "Day 1: Skip the Wait", track: "builder-tools", capacity: 300 },
      { id: "s2", title: "Day 1: Serverless at Scale", track: "serverless", capacity: 450 },
      { id: "s5", title: "Day 1: GenAI for Builders", track: "ai", capacity: 600 },
    ];
  }

  // ---- tabs ----
  function setupTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    var panels = {
      reactions: document.getElementById("panelReactions"),
      sessions: document.getElementById("panelSessions"),
    };
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.dataset.tab;
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("selected", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        Object.keys(panels).forEach(function (k) {
          if (panels[k]) panels[k].hidden = k !== target;
        });
      });
    });
  }

  // ---- boot ----
  setupTabs();
  renderInsights();
  refresh();
  setInterval(refresh, POLL_MS);
})();
