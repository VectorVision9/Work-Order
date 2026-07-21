// =========================================================
// E-OFFICE — app logic
// =========================================================
const { createClient } = supabase;

// Main client — used for whoever is actually logged in on this device
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Secondary client — used ONLY to create new employee accounts, so that
// creating an employee never logs the boss out of their own session.
const sbAdmin = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let currentUser = null;
let currentProfile = null;
let allTasksCache = [];
let employeesCache = [];

// ---------- element shortcuts ----------
const $ = (id) => document.getElementById(id);

// ---------- ripple effect (modern button interaction, all dashboards) ----------
const RIPPLE_SELECTOR = '.btn-primary, .btn-secondary, .btn-secondary-small, .ic-remove, .topbar-right button';
document.addEventListener('click', (e) => {
  const btn = e.target.closest(RIPPLE_SELECTOR);
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple-effect';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

// ---------- view switching ----------
function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
  document.body.classList.remove('app-theme');
  stopPresenceHeartbeat();
  stopNotificationRealtime();
}

// ---------- theme (dark is the default look; light mode is the alternate) ----------
function getThemePref() {
  return localStorage.getItem('eoffice-theme') || 'dark';
}
function applyTheme(theme) {
  document.body.classList.toggle('app-theme', theme === 'dark');
  const btn = $('theme-toggle-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const next = getThemePref() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('eoffice-theme', next);
  applyTheme(next);
  // Chart.js computes grid/text colors at draw time based on the theme,
  // so charts already on screen need a redraw or they'll stay stuck with
  // the old theme's colors until the next full page load.
  if ($('an-total') && typeof Chart !== 'undefined') renderAnalytics();
}
$('theme-toggle-btn').addEventListener('click', toggleTheme);

$('holiday-view-all-btn').addEventListener('click', () => {
  holidayListExpanded = !holidayListExpanded;
  renderHolidayWidget();
});

// ---- fullscreen toggle ----
$('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});
function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
}

$('show-signup').addEventListener('click', () => {
  $('login-box').classList.add('hidden');
  $('signup-box').classList.remove('hidden');
});
$('show-login').addEventListener('click', () => {
  $('signup-box').classList.add('hidden');
  $('login-box').classList.remove('hidden');
});

// ---------- boot ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await onLoggedIn(session.user);
  } else {
    showAuth();
  }
}

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    currentProfile = null;
    showAuth();
  }
});

async function onLoggedIn(user) {
  currentUser = user;
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    $('login-error').textContent = 'Could not load your profile. Contact your admin.';
    await sb.auth.signOut();
    return;
  }

  currentProfile = profile;
  $('who-label').textContent = `Welcome back, ${profile.full_name}`;
  showApp();
  applyTheme(getThemePref());
  renderDailyQuote();
  startPresenceHeartbeat();
  await loadNotifications();
  startNotificationRealtime();
  // fire-and-forget: push setup must never be able to block the rest of
  // the app from loading, even if a browser/permission/network quirk
  // makes some part of it hang or fail
  initPushNotifications();

  $('sidebar-user-avatar').textContent = getInitials(profile.full_name);
  $('sidebar-user-name').textContent = profile.full_name;
  $('sidebar-user-role').textContent = profile.role === 'boss' ? 'Boss' : (profile.designation || 'Employee');
  renderSidebarNav();

  if (profile.role === 'boss') {
    $('boss-view').classList.remove('hidden');
    $('employee-view').classList.add('hidden');
    await loadBossData();
  } else {
    $('employee-view').classList.remove('hidden');
    $('boss-view').classList.add('hidden');
    await loadEmployeeData();
  }
}

// ---------- login ----------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    $('login-error').textContent = error.message;
    return;
  }
  await onLoggedIn(data.user);
});

// ---------- boss signup (first-time setup) ----------
$('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signup-error').textContent = '';
  const full_name = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    $('signup-error').textContent = error.message;
    return;
  }
  if (!data.user) {
    $('signup-error').textContent = 'Check your email to confirm your account, then log in.';
    return;
  }
  const { error: profileError } = await sb.from('profiles').insert({
    id: data.user.id,
    full_name,
    email,
    role: 'boss'
  });
  if (profileError) {
    if (profileError.code === '42501') {
      $('signup-error').textContent = 'A boss account already exists for this site. If this is your business, ask your boss for a login instead.';
    } else {
      $('signup-error').textContent = profileError.message;
    }
    return;
  }
  await onLoggedIn(data.user);
});

// ---------- logout ----------
$('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

// =========================================================
// BOSS DASHBOARD
// =========================================================
async function loadBossData() {
  await generateRecurringTasks();
  await Promise.all([loadEmployees(), loadTasks(), loadNotices(), loadRecurringTasks()]);
  renderEmployeeOfMonth();
  renderAnalytics();
}

async function loadEmployees() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('role', 'employee')
    .order('full_name');

  if (error) { console.error(error); return; }
  employeesCache = data || [];

  // employee ID card grid
  const list = $('employee-list');
  list.innerHTML = '';
  if (employeesCache.length === 0) {
    list.innerHTML = '<p style="color:#5B6472;font-style:italic;">No employees yet — add your first one below.</p>';
  } else {
    employeesCache.forEach(emp => {
      const theme = emp.card_theme || 'navy';
      const bg = emp.card_bg || 'mesh';
      const card = document.createElement('div');
      card.className = `id-card theme-${theme} bg-${bg}`;
      card.dataset.empId = emp.id;
      card.innerHTML = `
        <div class="ic-bg"></div>
        <div class="ic-glare"></div>
        <button class="ic-remove" data-remove-emp="${emp.id}" data-emp-name="${escapeHtml(emp.full_name)}">Remove</button>
        <div class="ic-content">
          <div class="ic-top">
            <div class="ic-avatar">${getInitials(emp.full_name)}</div>
          </div>
          <div class="ic-code">${employeeCode(emp)}</div>
          <div class="ic-name">${escapeHtml(emp.full_name)}</div>
          <div class="ic-details">
            ${emp.designation ? `<div class="ic-row ic-designation"><span class="ic-icon">💼</span>${escapeHtml(emp.designation)}</div>` : ''}
            <div class="ic-row"><span class="ic-icon">📧</span>${escapeHtml(emp.email || '—')}</div>
            <div class="ic-row"><span class="ic-icon">📱</span>${escapeHtml(emp.mobile || '—')}</div>
          </div>
          <div class="ic-footer"><span class="ic-status-dot ${getOnlineStatus(emp.last_seen_at).online ? '' : 'offline'}"></span>${escapeHtml(getOnlineStatus(emp.last_seen_at).label)}</div>
        </div>
      `;
      list.appendChild(card);
      attachCardTilt(card);
    });
  }
  $('employee-count-tag').textContent = employeesCache.length;

  list.querySelectorAll('.id-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button[data-remove-emp]')) return;
      const emp = employeesCache.find(x => x.id === card.dataset.empId);
      if (emp) openEmployeeDrawer(emp);
    });
  });

  list.querySelectorAll('button[data-remove-emp]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.empName;
      const confirmed = confirm(
        `Remove ${name}?\n\nThey will no longer appear in your employee list or be able to use the app. ` +
        `Any tasks currently assigned to them will show as "Unassigned" so you can hand them to someone else. ` +
        `Their past task history is kept.`
      );
      if (!confirmed) return;

      btn.disabled = true;
      btn.textContent = 'Removing...';
      const { error } = await sb
        .from('profiles')
        .delete()
        .eq('id', btn.dataset.removeEmp)
        .eq('role', 'employee');

      if (error) {
        alert('Could not remove employee: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Remove';
        return;
      }
      await loadEmployees();
      await loadTasks();
    });
  });

  // dropdowns
  const assignSelect = $('assign-employee');
  const filterSelect = $('filter-employee');
  assignSelect.innerHTML = '';
  filterSelect.innerHTML = '<option value="">All employees</option>';
  employeesCache.forEach(emp => {
    assignSelect.innerHTML += `<option value="${emp.id}">${escapeHtml(emp.full_name)}</option>`;
    filterSelect.innerHTML += `<option value="${emp.id}">${escapeHtml(emp.full_name)}</option>`;
  });
}

async function loadTasks() {
  const { data, error } = await sb
    .from('tasks')
    .select('*, employee:profiles!tasks_assigned_to_fkey(full_name)')
    .order('deadline', { ascending: true });

  if (error) { console.error(error); return; }
  allTasksCache = data || [];
  renderTasksTable();
}

function renderTasksTable() {
  const empFilter = $('filter-employee').value;
  const statusFilter = $('filter-status').value;
  const tbody = $('tasks-tbody');
  tbody.innerHTML = '';

  const rows = allTasksCache.filter(t => {
    if (empFilter && t.assigned_to !== empFilter) return false;
    if (statusFilter === 'overdue') return isOverdue(t);
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No tasks match this view yet.</td></tr>';
    return;
  }

  rows.forEach(t => {
    const meta = statusMeta(t);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.employee?.full_name || 'Unassigned')}</td>
      <td><strong>${escapeHtml(t.title)}</strong>${t.description ? `<div style="color:#5B6472;font-size:12px;margin-top:4px;">${escapeHtml(t.description)}</div>` : ''}</td>
      <td>${formatDate(t.deadline)}</td>
      <td><span class="badge ${meta.cls}">${meta.icon} ${meta.label}</span></td>
      <td>${formatDate(t.created_at)}</td>
      <td style="white-space:nowrap;">
        <button class="btn-text-small" data-history="${t.id}" data-title="${escapeHtml(t.title)}">View</button>
        &nbsp;·&nbsp;
        <button class="btn-text-small" data-comments="${t.id}" data-title="${escapeHtml(t.title)}">💬 Comments</button>
        &nbsp;·&nbsp;
        <button class="btn-danger-text" data-delete-task="${t.id}" data-task-title="${escapeHtml(t.title)}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openHistoryModal(btn.dataset.history, btn.dataset.title));
  });

  tbody.querySelectorAll('button[data-comments]').forEach(btn => {
    btn.addEventListener('click', () => openCommentsModal(btn.dataset.comments, btn.dataset.title));
  });

  tbody.querySelectorAll('button[data-delete-task]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = confirm(`Delete "${btn.dataset.taskTitle}"? This permanently removes the task and its history. This cannot be undone.`);
      if (!ok) return;
      btn.disabled = true;
      const { error } = await sb.from('tasks').delete().eq('id', btn.dataset.deleteTask);
      if (error) {
        alert('Could not delete task: ' + error.message);
        btn.disabled = false;
        return;
      }
      await loadTasks();
    });
  });
}

$('filter-employee').addEventListener('change', renderTasksTable);
$('filter-status').addEventListener('change', renderTasksTable);

// ---------- assign task ----------
$('assign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('assign-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const assigned_to = $('assign-employee').value;
  const deadline = $('assign-deadline').value;
  const title = $('assign-title').value.trim();
  const description = $('assign-desc').value.trim();
  const repeat = $('assign-repeat').value; // 'none' | 'daily' | 'weekly' | 'monthly'

  if (!assigned_to) {
    msg.textContent = 'Add an employee first.';
    msg.className = 'msg err';
    return;
  }

  const { data: inserted, error } = await sb.from('tasks').insert({
    title, description, deadline,
    assigned_to,
    created_by: currentUser.id,
    status: 'assigned'
  }).select().single();

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  await sb.from('task_events').insert({
    task_id: inserted.id,
    event_type: 'assigned',
    from_employee: null,
    to_employee: assigned_to,
    actor: currentUser.id
  });

  await createNotification(assigned_to, 'task_assigned', 'New task assigned', `Boss assigned you a task: "${title}"`, inserted.id);

  // this first task already covers the deadline just picked — the
  // recurring template only needs to know when the NEXT one is due
  if (repeat !== 'none') {
    const anchor = parseDateStr(deadline);
    const next = nextOccurrence(repeat, anchor, [anchor.getDay()], anchor.getDate());
    const { error: recurError } = await sb.from('recurring_tasks').insert({
      title, description, assigned_to,
      frequency: repeat,
      days_of_week: repeat === 'weekly' ? [anchor.getDay()] : null,
      day_of_month: repeat === 'monthly' ? anchor.getDate() : null,
      next_run_date: toDateStr(next),
      active: true,
      created_by: currentUser.id
    });
    if (recurError) {
      msg.textContent = `Task assigned, but the repeat schedule couldn't be saved (${recurError.message}). Have you run supabase-migration-v2.sql yet?`;
      msg.className = 'msg err';
      e.target.reset();
      await loadTasks();
      await loadRecurringTasks();
      return;
    }
  }

  msg.textContent = repeat === 'none' ? 'Task assigned.' : 'Task assigned — it will repeat automatically from here on.';
  msg.className = 'msg ok';
  e.target.reset();
  await loadTasks();
  await loadRecurringTasks();
});

// ---------- add employee modal ----------
$('open-add-employee').addEventListener('click', () => {
  $('ae-msg').textContent = '';
  $('add-employee-form').reset();
  $('ae-theme-swatches').querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  $('ae-theme-swatches').querySelector('[data-theme="navy"]').classList.add('selected');
  $('ae-theme').value = 'navy';
  $('add-employee-modal').classList.remove('hidden');
});
$('ae-cancel').addEventListener('click', () => $('add-employee-modal').classList.add('hidden'));

$('ae-theme-swatches').querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    $('ae-theme-swatches').querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    $('ae-theme').value = swatch.dataset.theme;
  });
});

$('add-employee-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('ae-msg');
  msg.textContent = 'Creating account...';
  msg.className = 'msg';

  const full_name = $('ae-name').value.trim();
  const email = $('ae-email').value.trim();
  const password = $('ae-password').value;
  const designation = $('ae-designation').value.trim();
  const department = $('ae-department').value.trim();
  const mobile = $('ae-mobile').value.trim();
  const card_theme = $('ae-theme').value;
  const card_bg = $('ae-bg').value;

  // Use the secondary client so we don't disturb the boss's session
  const { data, error } = await sbAdmin.auth.signUp({ email, password });
  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }
  if (!data.user) {
    msg.textContent = 'Email confirmation is required in Supabase settings — please disable "Confirm email" (see setup guide) and try again.';
    msg.className = 'msg err';
    return;
  }

  const { error: profileError } = await sbAdmin.from('profiles').insert({
    id: data.user.id,
    full_name,
    email,
    role: 'employee',
    designation, department, mobile, card_theme, card_bg
  });

  if (profileError) {
    msg.textContent = profileError.message;
    msg.className = 'msg err';
    return;
  }

  msg.textContent = 'Employee added!';
  msg.className = 'msg ok';
  await loadEmployees();
  await Promise.all(
    employeesCache
      .filter(e => e.id !== data.user.id)
      .map(e => createNotification(e.id, 'employee_added', 'New teammate joined', `${full_name} joined the team`))
  );
  setTimeout(() => $('add-employee-modal').classList.add('hidden'), 800);
});

// ---------- PDF export ----------
$('download-pdf-btn').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('E-Office — Task Report', 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22);

  const rows = allTasksCache.map(t => {
    const meta = statusMeta(t);
    return [
      t.employee?.full_name || 'Unassigned',
      t.title,
      formatDate(t.deadline),
      meta.label,
      formatDate(t.created_at),
      t.completed_at ? formatDate(t.completed_at) : '—'
    ];
  });

  doc.autoTable({
    head: [['Employee', 'Task', 'Deadline', 'Status', 'Assigned On', 'Completed On']],
    body: rows,
    startY: 28,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [27, 30, 35] }
  });

  doc.save(`work-order-report-${new Date().toISOString().slice(0, 10)}.pdf`);
});

// =========================================================
// NOTICES & ANNOUNCEMENTS (visible to boss + all employees)
// =========================================================
let noticesCache = [];

async function loadNotices() {
  const { data, error } = await sb
    .from('notices')
    .select('*, author:profiles!notices_created_by_fkey(full_name)')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) { console.error(error); return; }
  noticesCache = data || [];
  renderNotices();
}

function renderNotices() {
  const isBoss = currentProfile?.role === 'boss';
  const list = $(isBoss ? 'notice-list-boss' : 'notice-list-emp');
  const tag = $(isBoss ? 'notice-count-tag' : 'notice-count-tag-emp');
  if (!list) return;

  tag.textContent = noticesCache.length;
  list.innerHTML = '';

  if (noticesCache.length === 0) {
    list.innerHTML = '<p class="notice-empty">No notices posted yet.</p>';
    return;
  }

  const categoryIcon = { general: '📢', closure: '🚪', meeting: '📅', holiday: '🎉', maintenance: '🛠️' };

  noticesCache.forEach(n => {
    const when = new Date(n.created_at).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    const icon = categoryIcon[n.category] || '📢';
    const card = document.createElement('div');
    card.className = 'notice-card' + (n.pinned ? ' pinned' : '');
    card.innerHTML = `
      <div class="n-top">
        <div class="n-title">${n.pinned ? '<span class="n-pin">📌</span>' : ''}<span class="n-cat-icon">${icon}</span>${escapeHtml(n.title)}</div>
        ${isBoss ? `<button class="n-delete" data-delete-notice="${n.id}">Delete</button>` : ''}
      </div>
      <div class="n-msg">${escapeHtml(n.message)}</div>
      <div class="n-meta">Posted by ${escapeHtml(n.author?.full_name || 'Boss')} · ${when}</div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('button[data-delete-notice]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = confirm('Delete this notice?');
      if (!ok) return;
      btn.disabled = true;
      const { error } = await sb.from('notices').delete().eq('id', btn.dataset.deleteNotice);
      if (error) {
        alert('Could not delete notice: ' + error.message);
        btn.disabled = false;
        return;
      }
      await loadNotices();
    });
  });
}

$('notice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('notice-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const title = $('notice-title').value.trim();
  const message = $('notice-message').value.trim();
  const pinned = $('notice-pinned').checked;
  const category = $('notice-category').value;

  const { error } = await sb.from('notices').insert({
    title, message, pinned, category,
    created_by: currentUser.id
  });

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  msg.textContent = 'Announcement posted.';
  msg.className = 'msg ok';
  e.target.reset();
  await loadNotices();
});

// =========================================================
// EMPLOYEE DASHBOARD
// =========================================================
let employeeDirectoryCache = [];

async function loadEmployeeData() {
  // fetch every task (the shared clipboard), newest deadline first
  const { data, error } = await sb
    .from('tasks')
    .select('*, employee:profiles!tasks_assigned_to_fkey(full_name)')
    .order('deadline', { ascending: true });

  if (error) { console.error(error); return; }
  allTasksCache = data || [];

  // also fetch the employee directory, so "not related to me" has someone to pick from
  // (also carries last_seen_at, used by the Team Status panel below)
  const { data: dir } = await sb
    .from('profiles')
    .select('id, full_name, last_seen_at')
    .eq('role', 'employee');
  employeeDirectoryCache = dir || [];

  await loadNotices();
  renderMyIdCard();
  await renderWorkInbox();
  renderEmployeeOfMonth();
  renderTeamStatus();
  renderHolidayWidget();
  renderEmployeeStatCards();
  await loadMyFiles();
  await checkDeadlineNotifications();
  await loadNotifications();
}

function renderEmployeeStatCards() {
  if (!$('es-my-tasks')) return;

  const myTasks = allTasksCache.filter(t => t.assigned_to === currentUser.id);
  const pending = myTasks.filter(t => t.status === 'assigned' || t.status === 'accepted').length;
  const inProgress = myTasks.filter(t => t.status === 'in_progress').length;
  $('es-my-tasks').textContent = pending + inProgress;
  $('es-my-tasks-pending').textContent = pending;
  $('es-my-tasks-inprogress').textContent = inProgress;

  const now = new Date();
  const thisMonthCount = myTasks.filter(t => t.status === 'complete' && t.completed_at &&
    new Date(t.completed_at).getFullYear() === now.getFullYear() &&
    new Date(t.completed_at).getMonth() === now.getMonth()).length;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthCount = myTasks.filter(t => t.status === 'complete' && t.completed_at &&
    new Date(t.completed_at).getFullYear() === lastMonthDate.getFullYear() &&
    new Date(t.completed_at).getMonth() === lastMonthDate.getMonth()).length;
  $('es-completed').textContent = thisMonthCount;
  const trendEl = $('es-completed-trend');
  if (lastMonthCount === 0) {
    trendEl.textContent = thisMonthCount > 0 ? 'New' : '—';
  } else {
    const pct = Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100);
    trendEl.textContent = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}%`;
  }

  const total = employeeDirectoryCache.length;
  const online = employeeDirectoryCache.filter(e => getOnlineStatus(e.last_seen_at).online).length;
  $('es-team').textContent = total;
  $('es-team-online').textContent = online;
  $('es-team-offline').textContent = total - online;

  const todayStr = toDateStr(new Date());
  const weekAhead = toDateStr(addDays(new Date(), 7));
  const openMyTasks = myTasks.filter(t => t.status !== 'complete');
  const dueToday = openMyTasks.filter(t => t.deadline === todayStr).length;
  const dueThisWeek = openMyTasks.filter(t => t.deadline > todayStr && t.deadline <= weekAhead).length;
  $('es-deadlines').textContent = dueToday + dueThisWeek;
  $('es-deadlines-today').textContent = dueToday;
  $('es-deadlines-week').textContent = dueThisWeek;
  $('es-deadlines-sub').textContent = `${dueToday} Today · ${dueThisWeek} This Week`;
}

function openFullTasksModal(employeeId, employeeName) {
  $('full-tasks-title').textContent = `${employeeName}'s full task history`;
  const listEl = $('full-tasks-list');

  const tasks = allTasksCache
    .filter(t => t.assigned_to === employeeId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (tasks.length === 0) {
    listEl.innerHTML = '<p class="full-tasks-empty">No tasks assigned yet.</p>';
  } else {
    listEl.innerHTML = tasks.map(t => {
      const meta = statusMeta(t);
      const metaText = t.status === 'complete'
        ? `Completed ${formatDate(t.completed_at)}`
        : `Due ${formatDate(t.deadline)}`;
      return `
        <div class="full-task-row ${meta.cls}">
          <div class="ftr-info">
            <div class="ftr-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
            <div class="ftr-meta">${metaText}</div>
          </div>
          <span class="ftr-badge">${meta.icon} ${meta.label}</span>
        </div>
      `;
    }).join('');
  }

  $('full-tasks-modal').classList.remove('hidden');
}

$('full-tasks-close').addEventListener('click', () => $('full-tasks-modal').classList.add('hidden'));

function renderMyIdCard() {
  const strip = $('employee-id-strip');
  if (!strip || !currentProfile) return;

  const theme = currentProfile.card_theme || 'navy';
  const bg = currentProfile.card_bg || 'mesh';

  const myTasks = allTasksCache.filter(t => t.assigned_to === currentUser.id);
  const completed = myTasks.filter(t => t.status === 'complete').length;
  const pending = myTasks.filter(t => t.status !== 'complete').length;
  const productivity = myTasks.length ? Math.round((completed / myTasks.length) * 100) : 0;

  strip.innerHTML = `
    <div class="id-card theme-${theme} bg-${bg}">
      <div class="ic-bg"></div>
      <div class="ic-glare"></div>
      <div class="ic-content">
        <div class="ic-top">
          <div class="ic-avatar">${getInitials(currentProfile.full_name)}</div>
        </div>
        <div class="ic-code">${employeeCode(currentProfile)}</div>
        <div class="ic-name">${escapeHtml(currentProfile.full_name)}</div>
        ${currentProfile.designation ? `<div class="ic-details"><div class="ic-row ic-designation"><span class="ic-icon">💼</span>${escapeHtml(currentProfile.designation)}</div></div>` : ''}
        <div class="mini-stats">
          <div class="m-stat"><div class="m-val">${completed}</div><div class="m-label">Completed</div></div>
          <div class="m-stat"><div class="m-val">${pending}</div><div class="m-label">Pending</div></div>
          <div class="m-stat"><div class="m-val">${productivity}%</div><div class="m-label">Productivity</div></div>
        </div>
        <div class="ic-footer"><span class="ic-status-dot ${getOnlineStatus(currentProfile.last_seen_at).online ? '' : 'offline'}"></span>${escapeHtml(getOnlineStatus(currentProfile.last_seen_at).label)}</div>
      </div>
    </div>
  `;
  attachCardTilt(strip.querySelector('.id-card'));
  strip.querySelector('.id-card').addEventListener('click', () => {
    openFullTasksModal(currentUser.id, currentProfile.full_name);
  });
}

// =========================================================
// WORK INBOX (employee dashboard) — replaces the old flat "Team clipboard"
// =========================================================
let inboxScope = 'mine';   // 'mine' | 'everyone'
let inboxTab = 'new';      // 'new' | 'in_progress' | 'completed' | 'archived'

function taskBucket(t) {
  if (t.status === 'complete') {
    const ageDays = t.completed_at ? (Date.now() - new Date(t.completed_at).getTime()) / 86400000 : 999;
    return ageDays > 7 ? 'archived' : 'completed';
  }
  return t.status === 'assigned' ? 'new' : 'in_progress'; // accepted or in_progress
}

let woNumberMap = null;
function getWoNumber(task) {
  if (!woNumberMap) {
    const sorted = [...allTasksCache].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    woNumberMap = new Map();
    sorted.forEach((t, i) => woNumberMap.set(t.id, `WO-${new Date(t.created_at).getFullYear()}-${1000 + i}`));
  }
  return woNumberMap.get(task.id) || 'WO-0000-0000';
}

function daysLeftInfo(task) {
  if (task.status === 'complete') return null;
  const deadline = parseDateStr(task.deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((deadline - today) / 86400000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: false };
  if (days === 1) return { text: '1 day left', overdue: false };
  return { text: `${days} days left`, overdue: false };
}

let ticketCommentCounts = {};
async function fetchTicketCommentCounts(taskIds) {
  ticketCommentCounts = {};
  if (!taskIds.length) return;
  const { data, error } = await sb.from('task_comments').select('task_id, attachment_url').in('task_id', taskIds);
  if (error || !data) return;
  data.forEach(c => {
    if (!ticketCommentCounts[c.task_id]) ticketCommentCounts[c.task_id] = { comments: 0, files: 0 };
    ticketCommentCounts[c.task_id].comments++;
    if (c.attachment_url) ticketCommentCounts[c.task_id].files++;
  });
}

let inboxScopeSide = 'mine';
let inboxTabSide = 'new';

async function renderWorkInbox() {
  woNumberMap = null; // recompute fresh each time, in case tasks changed

  // ---- dashboard-embedded Work Inbox ----
  const grid = $('my-tickets');
  if (grid) {
    const scoped = inboxScope === 'mine'
      ? allTasksCache.filter(t => t.assigned_to === currentUser.id)
      : allTasksCache;

    const buckets = { new: [], in_progress: [], completed: [], archived: [] };
    scoped.forEach(t => buckets[taskBucket(t)].push(t));

    Object.keys(buckets).forEach(key => {
      const el = $('tab-count-' + key);
      if (el) el.textContent = buckets[key].length;
    });
    $('my-task-count').textContent = scoped.length;
    updateSidebarInboxBadge();

    const visible = buckets[inboxTab] || [];
    await fetchTicketCommentCounts(visible.map(t => t.id));
    renderMyTickets(visible, 'my-tickets', false);
  }

  // ---- dedicated sidebar Work Inbox page (split list + detail) ----
  const gridSide = $('my-tickets-side');
  if (gridSide) {
    const scopedSide = inboxScopeSide === 'mine'
      ? allTasksCache.filter(t => t.assigned_to === currentUser.id)
      : allTasksCache;

    const bucketsSide = { new: [], in_progress: [], completed: [], archived: [] };
    scopedSide.forEach(t => bucketsSide[taskBucket(t)].push(t));

    Object.keys(bucketsSide).forEach(key => {
      const el = $('tab-count-' + key + '-side');
      if (el) el.textContent = bucketsSide[key].length;
    });
    $('my-task-count-side').textContent = scopedSide.length;

    const visibleSide = bucketsSide[inboxTabSide] || [];
    await fetchTicketCommentCounts(visibleSide.map(t => t.id));
    renderMyTickets(visibleSide, 'my-tickets-side', true);
  }
}

document.querySelectorAll('.inbox-scope-btn[data-scope-side]').forEach(btn => {
  btn.addEventListener('click', () => {
    inboxScopeSide = btn.dataset.scopeSide;
    document.querySelectorAll('[data-scope-side]').forEach(b => b.classList.toggle('active', b === btn));
    renderWorkInbox();
  });
});
document.querySelectorAll('.inbox-tab[data-tab-side]').forEach(btn => {
  btn.addEventListener('click', () => {
    inboxTabSide = btn.dataset.tabSide;
    document.querySelectorAll('[data-tab-side]').forEach(b => b.classList.toggle('active', b === btn));
    renderWorkInbox();
  });
});

document.querySelectorAll('.inbox-scope-btn[data-scope]').forEach(btn => {
  btn.addEventListener('click', () => {
    inboxScope = btn.dataset.scope;
    document.querySelectorAll('.inbox-scope-btn[data-scope]').forEach(b => b.classList.toggle('active', b === btn));
    renderWorkInbox();
  });
});
document.querySelectorAll('.inbox-tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    inboxTab = btn.dataset.tab;
    document.querySelectorAll('.inbox-tab[data-tab]').forEach(b => b.classList.toggle('active', b === btn));
    renderWorkInbox();
  });
});

function renderMyTickets(tasks, targetId = 'my-tickets', inline = false) {
  const grid = $(targetId);
  if (!grid) return;
  grid.innerHTML = '';

  if (tasks.length === 0) {
    grid.innerHTML = '<p style="color:#5B6472;font-style:italic;">Nothing here right now.</p>';
    return;
  }

  tasks.forEach(t => {
    const meta = statusMeta(t);
    const isMine = t.assigned_to === currentUser.id;
    const assigneeName = isMine ? currentProfile.full_name : (t.employee?.full_name || 'someone else');

    let actionsHtml = '';
    if (isMine) {
      if (t.status === 'assigned') {
        actionsHtml = `
          <div class="actions">
            <button class="btn-primary" data-accept="${t.id}">✅ Accept</button>
            <button class="btn-secondary-small" data-reassign="${t.id}">Not related to me</button>
          </div>`;
      } else if (t.status === 'accepted') {
        actionsHtml = `
          <div class="actions">
            <button class="btn-primary" data-start="${t.id}">▶️ Start work</button>
          </div>`;
      } else if (t.status === 'in_progress') {
        actionsHtml = `
          <div class="actions">
            <button class="btn-primary" data-complete="${t.id}">✔️ Mark complete</button>
          </div>`;
      }
    }

    const card = document.createElement('div');
    card.className = 'ticket status-' + meta.cls + (isMine ? '' : ' readonly') + (inline ? ' ticket-clickable' : '');
    if (inline) card.dataset.taskId = t.id;
    const dl = daysLeftInfo(t);
    const counts = ticketCommentCounts[t.id] || { comments: 0, files: 0 };
    card.innerHTML = `
      <div class="stamp ${meta.cls}">${meta.icon} ${meta.label}</div>
      <span class="wo-number">${getWoNumber(t)}</span>
      <div class="assignee"><span class="chip ${getAvatarColorClass(assigneeName)}">${getInitials(assigneeName)}</span>${isMine ? 'Assigned to you' : 'Assigned to ' + escapeHtml(t.employee?.full_name || 'someone else')}</div>
      <h3>${escapeHtml(t.title)}</h3>
      ${t.description && !inline ? `<p class="desc">${escapeHtml(t.description)}</p>` : ''}
      <div class="meta ${isOverdue(t) ? 'overdue' : ''}">Deadline: ${formatDate(t.deadline)}${dl ? ` &nbsp;·&nbsp; <span class="days-left ${dl.overdue ? 'overdue' : ''}">⏱ ${dl.text}</span>` : ''}</div>
      ${t.status === 'complete' ? `<div class="meta">Completed ${formatDate(t.completed_at)}</div>` : ''}
      <div class="ticket-counts">
        <span>📎 ${counts.files} File${counts.files === 1 ? '' : 's'}</span>
        <span>💬 ${counts.comments} Comment${counts.comments === 1 ? '' : 's'}</span>
      </div>
      ${inline ? '' : `
      <div style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-text-small" data-history="${t.id}" data-title="${escapeHtml(t.title)}">View history</button>
        <button class="btn-text-small" data-comments="${t.id}" data-title="${escapeHtml(t.title)}">💬 Comments</button>
      </div>`}
      ${actionsHtml}
    `;
    grid.appendChild(card);
  });

  if (inline) {
    grid.querySelectorAll('.ticket-clickable').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // let action buttons handle their own clicks
        openInlineTaskDetail(card.dataset.taskId);
      });
    });
  }

  grid.querySelectorAll('button[data-accept]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Accepting...';
      const taskId = btn.dataset.accept;
      const { error } = await sb.from('tasks')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', taskId).eq('assigned_to', currentUser.id);
      if (error) { alert('Could not update task: ' + error.message); btn.disabled = false; btn.textContent = '✅ Accept'; return; }
      await sb.from('task_events').insert({ task_id: taskId, event_type: 'accepted', actor: currentUser.id });
      const t = allTasksCache.find(x => x.id === taskId);
      if (t) await notifyBoss('task_accepted', 'Task accepted', `${currentProfile.full_name} accepted the task: "${t.title}"`, taskId);
      await loadEmployeeData();
      if (inline) openInlineTaskDetail(taskId);
    });
  });

  grid.querySelectorAll('button[data-start]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Starting...';
      const taskId = btn.dataset.start;
      const { error } = await sb.from('tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', taskId).eq('assigned_to', currentUser.id);
      if (error) { alert('Could not update task: ' + error.message); btn.disabled = false; btn.textContent = '▶️ Start work'; return; }
      await sb.from('task_events').insert({ task_id: taskId, event_type: 'started', actor: currentUser.id });
      const t = allTasksCache.find(x => x.id === taskId);
      if (t) await notifyBoss('task_started', 'Work started', `${currentProfile.full_name} started work on: "${t.title}"`, taskId);
      await loadEmployeeData();
      if (inline) openInlineTaskDetail(taskId);
    });
  });

  grid.querySelectorAll('button[data-complete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Saving...';
      const taskId = btn.dataset.complete;
      const { error } = await sb
        .from('tasks')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('assigned_to', currentUser.id);
      if (error) {
        alert('Could not update task: ' + error.message);
        btn.disabled = false;
        btn.textContent = '✔️ Mark complete';
        return;
      }
      await sb.from('task_events').insert({ task_id: taskId, event_type: 'completed', actor: currentUser.id });
      const t = allTasksCache.find(x => x.id === taskId);
      if (t) await notifyBoss('task_completed', 'Task completed', `${currentProfile.full_name} completed: "${t.title}"`, taskId);
      await loadEmployeeData();
      if (inline) openInlineTaskDetail(taskId);
    });
  });

  grid.querySelectorAll('button[data-reassign]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openReassignModal(btn.dataset.reassign); });
  });

  grid.querySelectorAll('button[data-history]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openHistoryModal(btn.dataset.history, btn.dataset.title); });
  });

  grid.querySelectorAll('button[data-comments]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openCommentsModal(btn.dataset.comments, btn.dataset.title); });
  });
}

// =========================================================
// Inline task detail panel (dedicated sidebar Work Inbox page)
// =========================================================
let inlineDetailTaskId = null;

async function openInlineTaskDetail(taskId) {
  const t = allTasksCache.find(x => x.id === taskId);
  if (!t) return;

  inlineDetailTaskId = taskId;
  $('idc-empty').classList.add('hidden');
  $('idc-content').classList.remove('hidden');

  const meta = statusMeta(t);
  const isMine = t.assigned_to === currentUser.id;
  const dl = daysLeftInfo(t);
  const counts = ticketCommentCounts[t.id] || { comments: 0, files: 0 };

  await getBossId(); // ensures cachedBossName is populated

  $('idc-wo').textContent = getWoNumber(t);
  $('idc-status-badge').innerHTML = `${meta.icon} ${meta.label}`;
  $('idc-status-badge').className = 'stamp ' + meta.cls;
  $('idc-title').textContent = t.title;
  $('idc-date').textContent = `📅 ${formatDate(t.deadline)}`;
  $('idc-days-left').textContent = dl ? `⏱ ${dl.text}` : '';
  $('idc-assigned-by').textContent = cachedBossName || 'Boss';
  $('idc-assigned-to').textContent = t.employee?.full_name || (isMine ? currentProfile.full_name : '—');
  $('idc-description').textContent = t.description || '—';
  $('idc-files-count').textContent = `📎 ${counts.files} File${counts.files === 1 ? '' : 's'}`;
  $('idc-comments-count').textContent = `💬 ${counts.comments} Comment${counts.comments === 1 ? '' : 's'}`;

  let actionsHtml = '';
  if (isMine) {
    if (t.status === 'assigned') {
      actionsHtml = `
        <button class="btn-primary" id="idc-accept-btn">✅ Accept</button>
        <button class="btn-secondary-small" id="idc-reassign-btn">Not related to me</button>`;
    } else if (t.status === 'accepted') {
      actionsHtml = `<button class="btn-primary" id="idc-start-btn">▶️ Start work</button>`;
    } else if (t.status === 'in_progress') {
      actionsHtml = `<button class="btn-primary" id="idc-complete-btn">✔️ Mark complete</button>`;
    }
  }
  $('idc-actions').innerHTML = actionsHtml;

  const acceptBtn = $('idc-accept-btn');
  if (acceptBtn) acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true; acceptBtn.textContent = 'Accepting...';
    const { error } = await sb.from('tasks').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', taskId).eq('assigned_to', currentUser.id);
    if (error) { alert('Could not update task: ' + error.message); return; }
    await sb.from('task_events').insert({ task_id: taskId, event_type: 'accepted', actor: currentUser.id });
    await notifyBoss('task_accepted', 'Task accepted', `${currentProfile.full_name} accepted the task: "${t.title}"`, taskId);
    await loadEmployeeData();
    openInlineTaskDetail(taskId);
  });
  const startBtn = $('idc-start-btn');
  if (startBtn) startBtn.addEventListener('click', async () => {
    startBtn.disabled = true; startBtn.textContent = 'Starting...';
    const { error } = await sb.from('tasks').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', taskId).eq('assigned_to', currentUser.id);
    if (error) { alert('Could not update task: ' + error.message); return; }
    await sb.from('task_events').insert({ task_id: taskId, event_type: 'started', actor: currentUser.id });
    await notifyBoss('task_started', 'Work started', `${currentProfile.full_name} started work on: "${t.title}"`, taskId);
    await loadEmployeeData();
    openInlineTaskDetail(taskId);
  });
  const completeBtn = $('idc-complete-btn');
  if (completeBtn) completeBtn.addEventListener('click', async () => {
    completeBtn.disabled = true; completeBtn.textContent = 'Saving...';
    const { error } = await sb.from('tasks').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', taskId).eq('assigned_to', currentUser.id);
    if (error) { alert('Could not update task: ' + error.message); return; }
    await sb.from('task_events').insert({ task_id: taskId, event_type: 'completed', actor: currentUser.id });
    await notifyBoss('task_completed', 'Task completed', `${currentProfile.full_name} completed: "${t.title}"`, taskId);
    await loadEmployeeData();
    openInlineTaskDetail(taskId);
  });
  const reassignBtn = $('idc-reassign-btn');
  if (reassignBtn) reassignBtn.addEventListener('click', () => openReassignModal(taskId));

  $('idc-history-btn').onclick = () => openHistoryModal(taskId, t.title);

  // comments + history auto-load, visible without an extra click
  await loadComments(taskId, 'idc-comments-list');
  await loadHistoryInto(taskId, 'idc-history-list');
}

$('idc-comment-file').addEventListener('change', () => {
  const file = $('idc-comment-file').files[0];
  if (file && !classifyFile(file)) {
    $('idc-comment-msg').textContent = 'Only images or PDF files are supported.';
    $('idc-comment-msg').className = 'msg err';
    $('idc-comment-file').value = '';
  }
});

$('idc-comment-send').addEventListener('click', async () => {
  const msg = $('idc-comment-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const message = $('idc-comment-message').value.trim();
  const file = $('idc-comment-file').files[0];
  if (!message && !file) {
    msg.textContent = 'Write something or attach a file first.';
    msg.className = 'msg err';
    return;
  }
  if (!inlineDetailTaskId) return;

  const sendBtn = $('idc-comment-send');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  let attachment = null;
  try {
    if (file) attachment = await uploadFileToStorage(file, `task-comments/${inlineDetailTaskId}`);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg err';
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    return;
  }

  const { error } = await sb.from('task_comments').insert({
    task_id: inlineDetailTaskId,
    author: currentUser.id,
    message: message || null,
    attachment_url: attachment?.url || null,
    attachment_name: attachment?.name || null,
    attachment_type: attachment?.type || null
  });

  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  $('idc-comment-message').value = '';
  $('idc-comment-file').value = '';
  await loadComments(inlineDetailTaskId, 'idc-comments-list');

  const t = allTasksCache.find(x => x.id === inlineDetailTaskId);
  if (t) {
    const recipient = currentProfile.role === 'boss' ? t.assigned_to : await getBossId();
    if (recipient && recipient !== currentUser.id) {
      await createNotification(recipient, 'comment', `${currentProfile.full_name} commented`, t.title, t.id);
    }
  }
});


function openReassignModal(taskId) {
  const select = $('reassign-employee');
  select.innerHTML = '';
  employeeDirectoryCache
    .filter(e => e.id !== currentUser.id)
    .forEach(e => {
      select.innerHTML += `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`;
    });

  if (select.options.length === 0) {
    select.innerHTML = '<option value="">No other employees yet</option>';
  }

  $('reassign-msg').textContent = '';
  $('reassign-form').dataset.taskId = taskId;
  $('reassign-modal').classList.remove('hidden');
}

$('reassign-cancel').addEventListener('click', () => $('reassign-modal').classList.add('hidden'));

$('reassign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('reassign-msg');
  const taskId = e.target.dataset.taskId;
  const newAssignee = $('reassign-employee').value;

  if (!newAssignee) {
    msg.textContent = 'No one to reassign to yet — ask your boss to add another employee.';
    msg.className = 'msg err';
    return;
  }

  const { error } = await sb
    .from('tasks')
    .update({ assigned_to: newAssignee })
    .eq('id', taskId)
    .eq('assigned_to', currentUser.id);

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  await sb.from('task_events').insert({
    task_id: taskId,
    event_type: 'reassigned',
    from_employee: currentUser.id,
    to_employee: newAssignee,
    actor: currentUser.id
  });

  $('reassign-modal').classList.add('hidden');
  await loadEmployeeData();
});

// =========================================================
// Change password (both roles)
// =========================================================
$('change-pw-btn').addEventListener('click', () => {
  $('pw-msg').textContent = '';
  $('change-pw-form').reset();
  $('change-pw-modal').classList.remove('hidden');
});
$('pw-cancel').addEventListener('click', () => $('change-pw-modal').classList.add('hidden'));

$('change-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('pw-msg');
  const newPassword = $('new-password').value;
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }
  msg.textContent = 'Password updated.';
  msg.className = 'msg ok';
  setTimeout(() => $('change-pw-modal').classList.add('hidden'), 800);
});

$('history-close').addEventListener('click', () => $('history-modal').classList.add('hidden'));

async function openHistoryModal(taskId, taskTitle) {
  $('history-title').textContent = `History — ${taskTitle}`;
  $('history-modal').classList.remove('hidden');
  await loadHistoryInto(taskId, 'history-list');
}

async function loadHistoryInto(taskId, listId) {
  const list = $(listId);
  if (!list) return;
  list.innerHTML = '<p style="color:#5B6472;font-style:italic;">Loading...</p>';

  const { data, error } = await sb
    .from('task_events')
    .select(`
      *,
      from_profile:profiles!task_events_from_employee_fkey(full_name),
      to_profile:profiles!task_events_to_employee_fkey(full_name),
      actor_profile:profiles!task_events_actor_fkey(full_name)
    `)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });

  if (error) {
    list.innerHTML = `<p style="color:var(--red);">Could not load history: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<p style="color:#5B6472;font-style:italic;">No history recorded for this task.</p>';
    return;
  }

  list.innerHTML = data.map(ev => {
    const when = new Date(ev.created_at).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    let line;
    if (ev.event_type === 'assigned') {
      line = `Assigned to <strong>${escapeHtml(ev.to_profile?.full_name || '—')}</strong> by ${escapeHtml(ev.actor_profile?.full_name || '—')}`;
    } else if (ev.event_type === 'reassigned') {
      line = `Reassigned from <strong>${escapeHtml(ev.from_profile?.full_name || '—')}</strong> to <strong>${escapeHtml(ev.to_profile?.full_name || '—')}</strong>`;
    } else if (ev.event_type === 'accepted') {
      line = `Accepted by <strong>${escapeHtml(ev.actor_profile?.full_name || '—')}</strong>`;
    } else if (ev.event_type === 'started') {
      line = `Work started by <strong>${escapeHtml(ev.actor_profile?.full_name || '—')}</strong>`;
    } else if (ev.event_type === 'completed') {
      line = `Marked complete by <strong>${escapeHtml(ev.actor_profile?.full_name || '—')}</strong>`;
    } else {
      line = escapeHtml(ev.event_type);
    }
    return `
      <div class="history-entry">
        <span class="h-type">${ev.event_type}</span>
        ${line}
        <div class="h-time">${when}</div>
      </div>
    `;
  }).join('');
}

// =========================================================
// Employee ID card helpers + profile drawer
// =========================================================
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const initials = parts.length === 1
    ? parts[0].slice(0, 2)
    : parts[0][0] + parts[parts.length - 1][0];
  return initials.toUpperCase();
}

function getAvatarColorClass(name) {
  if (!name) return 'chip-0';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return 'chip-' + (Math.abs(hash) % 5);
}

function employeeCode(emp) {
  // employee_seq comes from a Postgres identity column (see setup SQL) so codes stay stable.
  const seq = emp.employee_seq;
  const n = (seq !== null && seq !== undefined) ? (1000 + Number(seq)) : (1000 + Math.abs(hashId(emp.id)) % 9000);
  return `EMP-${n}`;
}
function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return h;
}

// subtle 3D tilt-on-hover for the ID cards
function attachCardTilt(card) {
  const maxTilt = 8;
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotY = (px - 0.5) * maxTilt * 2;
    const rotX = (0.5 - py) * maxTilt * 2;
    card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) scale(1)';
  });
}

let drawerEmpId = null;

function openEmployeeDrawer(emp) {
  drawerEmpId = emp.id;

  $('drawer-avatar').textContent = getInitials(emp.full_name);
  $('drawer-name').textContent = emp.full_name;
  $('drawer-designation').textContent = emp.designation || 'No designation set';
  $('drawer-id').textContent = employeeCode(emp);
  $('drawer-department').textContent = emp.department || '—';
  $('drawer-email').textContent = emp.email || '—';
  $('drawer-mobile').textContent = emp.mobile || '—';
  $('drawer-attendance-input').value = (emp.attendance_pct ?? '');
  $('drawer-attendance-msg').textContent = '';

  const myTasks = allTasksCache.filter(t => t.assigned_to === emp.id);
  const completed = myTasks.filter(t => t.status === 'complete').length;
  const pending = myTasks.filter(t => t.status !== 'complete').length;
  const productivity = myTasks.length ? Math.round((completed / myTasks.length) * 100) : 0;

  $('drawer-completed').textContent = completed;
  $('drawer-pending').textContent = pending;
  $('drawer-productivity').textContent = `${productivity}%`;

  $('profile-drawer-backdrop').classList.remove('hidden');
}

$('drawer-close').addEventListener('click', () => $('profile-drawer-backdrop').classList.add('hidden'));
$('profile-drawer-backdrop').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) $('profile-drawer-backdrop').classList.add('hidden');
});

$('drawer-attendance-save').addEventListener('click', async () => {
  const msg = $('drawer-attendance-msg');
  const val = $('drawer-attendance-input').value;
  const attendance_pct = val === '' ? null : Math.max(0, Math.min(100, Number(val)));

  msg.textContent = 'Saving...';
  msg.className = 'msg';

  const { error } = await sb
    .from('profiles')
    .update({ attendance_pct })
    .eq('id', drawerEmpId);

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }
  msg.textContent = 'Saved.';
  msg.className = 'msg ok';
  const emp = employeesCache.find(e => e.id === drawerEmpId);
  if (emp) emp.attendance_pct = attendance_pct;
});

// =========================================================
// helpers
// =========================================================
function isPast(dateStr) {
  const d = new Date(dateStr + 'T23:59:59');
  return d.getTime() < Date.now();
}

// =========================================================
// TASK FLOW — Assigned -> Accepted -> In Progress -> Complete
// Single source of truth for how a task's status displays everywhere
// (badges, tickets, history, analytics) so nothing drifts out of sync.
// =========================================================
function statusMeta(t) {
  if (t.status === 'complete') return { cls: 'complete', label: 'Complete', icon: '✅' };
  if (isPast(t.deadline)) return { cls: 'overdue', label: 'Overdue', icon: '⚠️' };
  if (t.status === 'in_progress') return { cls: 'in-progress', label: 'In Progress', icon: '🟡' };
  if (t.status === 'accepted') return { cls: 'accepted', label: 'Accepted', icon: '🔵' };
  return { cls: 'assigned', label: 'New', icon: '🔴' };
}
function isOverdue(t) {
  return t.status !== 'complete' && isPast(t.deadline);
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =========================================================
// date helpers (used by recurring tasks) — all in LOCAL time,
// deliberately avoiding toISOString()/new Date(str) for date-only
// values so nothing shifts by a day across timezones.
// =========================================================
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function nextOccurrence(freq, current, daysOfWeek, dayOfMonth) {
  if (freq === 'daily') return addDays(current, 1);

  if (freq === 'weekly') {
    const wanted = (daysOfWeek && daysOfWeek.length) ? daysOfWeek : [current.getDay()];
    let d = addDays(current, 1);
    for (let i = 0; i < 8; i++) {
      if (wanted.includes(d.getDay())) return d;
      d = addDays(d, 1);
    }
    return addDays(current, 7); // fallback, shouldn't normally hit this
  }

  if (freq === 'monthly') {
    const day = dayOfMonth || current.getDate();
    let d = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    const lastDayOfThatMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDayOfThatMonth));
    return d;
  }

  return addDays(current, 1);
}

// =========================================================
// RECURRING TASKS
// =========================================================
async function generateRecurringTasks() {
  const { data: templates, error } = await sb
    .from('recurring_tasks')
    .select('*')
    .eq('active', true);

  // if the table doesn't exist yet (migration not run), just skip quietly —
  // the rest of the dashboard should still work fine without it.
  if (error || !templates || templates.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const tmpl of templates) {
    if (!tmpl.assigned_to) continue; // employee was removed — nothing to assign to, skip

    let next = parseDateStr(tmpl.next_run_date);
    let created = false;
    let safety = 0;

    while (next.getTime() <= today.getTime() && safety < 60) {
      const { data: inserted, error: insertErr } = await sb.from('tasks').insert({
        title: tmpl.title,
        description: tmpl.description,
        assigned_to: tmpl.assigned_to,
        deadline: toDateStr(next),
        created_by: tmpl.created_by,
        status: 'assigned'
      }).select().single();

      if (!insertErr && inserted) {
        await createNotification(tmpl.assigned_to, 'task_assigned', 'New task assigned', `Boss assigned you a task: "${tmpl.title}"`, inserted.id);
        await sb.from('task_events').insert({
          task_id: inserted.id,
          event_type: 'assigned',
          from_employee: null,
          to_employee: tmpl.assigned_to,
          actor: tmpl.created_by
        });
      }

      next = nextOccurrence(tmpl.frequency, next, tmpl.days_of_week, tmpl.day_of_month);
      created = true;
      safety++;
    }

    if (created) {
      await sb.from('recurring_tasks').update({ next_run_date: toDateStr(next) }).eq('id', tmpl.id);
    }
  }
}

let recurringTasksCache = [];

async function loadRecurringTasks() {
  const list = $('recurring-list');
  const tag = $('recurring-count-tag');
  if (!list) return;

  const { data, error } = await sb
    .from('recurring_tasks')
    .select('*, employee:profiles!recurring_tasks_assigned_to_fkey(full_name)')
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p class="recurring-empty">Recurring tasks aren't set up yet — run supabase-migration-v2.sql in Supabase to enable this.</p>`;
    tag.textContent = '0';
    return;
  }

  recurringTasksCache = data || [];
  tag.textContent = recurringTasksCache.length;

  if (recurringTasksCache.length === 0) {
    list.innerHTML = '<p class="recurring-empty">No recurring tasks yet — pick "Repeat" when assigning a task above.</p>';
    return;
  }

  const freqLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

  list.innerHTML = '';
  recurringTasksCache.forEach(r => {
    const row = document.createElement('div');
    row.className = 'recurring-row' + (r.active ? '' : ' paused');
    row.innerHTML = `
      <div class="rr-info">
        <div class="rr-title">${escapeHtml(r.title)}</div>
        <div class="rr-meta">${freqLabel[r.frequency] || r.frequency} · ${r.assigned_to ? escapeHtml(r.employee?.full_name || 'Unknown') : '⚠ employee removed'} · next: ${formatDate(r.next_run_date)}${r.active ? '' : ' · PAUSED'}</div>
      </div>
      <div class="rr-actions">
        <button class="btn-secondary-small" data-toggle-recur="${r.id}" data-active="${r.active}">${r.active ? 'Pause' : 'Resume'}</button>
        <button class="btn-secondary-small" data-delete-recur="${r.id}" data-recur-title="${escapeHtml(r.title)}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('button[data-toggle-recur]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nowActive = btn.dataset.active === 'true';
      btn.disabled = true;
      const { error } = await sb.from('recurring_tasks').update({ active: !nowActive }).eq('id', btn.dataset.toggleRecur);
      if (error) { alert('Could not update: ' + error.message); btn.disabled = false; return; }
      await loadRecurringTasks();
    });
  });

  list.querySelectorAll('button[data-delete-recur]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = confirm(`Stop "${btn.dataset.recurTitle}" from repeating? Tasks already created stay as they are — only future occurrences stop.`);
      if (!ok) return;
      btn.disabled = true;
      const { error } = await sb.from('recurring_tasks').delete().eq('id', btn.dataset.deleteRecur);
      if (error) { alert('Could not delete: ' + error.message); btn.disabled = false; return; }
      await loadRecurringTasks();
    });
  });
}

// =========================================================
// EMPLOYEE OF THE MONTH — shared banner (both dashboards)
// =========================================================
function renderEmployeeOfMonth() {
  const body = $('eom-body');
  if (!body) return;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const counts = {}; // employee id -> { name, count }
  allTasksCache.forEach(t => {
    if (t.status !== 'complete' || !t.completed_at || !t.assigned_to) return;
    const d = new Date(t.completed_at);
    if (d.getFullYear() !== y || d.getMonth() !== m) return;
    const name = t.employee?.full_name || 'Someone';
    if (!counts[t.assigned_to]) counts[t.assigned_to] = { name, count: 0 };
    counts[t.assigned_to].count++;
  });

  const ranked = Object.values(counts).sort((a, b) => b.count - a.count);

  if (ranked.length === 0) {
    body.innerHTML = `No completions yet this month — be the first!`;
    return;
  }

  const winner = ranked[0];
  const monthName = now.toLocaleDateString(undefined, { month: 'long' });
  const isTie = ranked.length > 1 && ranked[1].count === winner.count;

  body.innerHTML = `
    ${escapeHtml(winner.name)}${isTie ? ' (tied)' : ''}
    <span class="eom-sub">${winner.count} task${winner.count === 1 ? '' : 's'} completed in ${monthName}</span>
  `;
}

// =========================================================
// ANALYTICS (boss dashboard)
// =========================================================
let analyticsCharts = {};

function renderAnalytics() {
  if (!$('an-total')) return; // panel only exists on the boss dashboard

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const recentTasks = allTasksCache.filter(t => new Date(t.created_at).getTime() >= thirtyDaysAgo);

  const total = recentTasks.length;
  const completed = recentTasks.filter(t => t.status === 'complete');
  const overdueNow = allTasksCache.filter(t => isOverdue(t)).length;
  const completionRate = total ? Math.round((completed.length / total) * 100) : 0;

  let avgTurnaround = '—';
  const turnaroundDays = completed
    .filter(t => t.completed_at && t.created_at)
    .map(t => (new Date(t.completed_at) - new Date(t.created_at)) / (1000 * 60 * 60 * 24));
  if (turnaroundDays.length) {
    avgTurnaround = (turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length).toFixed(1);
  }

  $('an-total').textContent = total;
  $('an-completion-rate').textContent = `${completionRate}%`;
  $('an-overdue').textContent = overdueNow;
  $('an-avg-turnaround').textContent = avgTurnaround;

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js did not load (check your internet connection / ad-blocker) — the stat numbers above still work, but the 3 charts below will stay empty.');
    ['chart-per-employee', 'chart-status', 'chart-trend'].forEach(id => {
      const canvas = $(id);
      if (canvas && canvas.parentElement) {
        canvas.parentElement.innerHTML = '<p style="color:#93A4BC;font-size:12.5px;font-style:italic;text-align:center;padding-top:30px;">Charts couldn\'t load — check your internet connection and refresh.</p>';
      }
    });
    return;
  }

  // ---- completed tasks per employee (all-time) ----
  const perEmployee = {};
  allTasksCache.forEach(t => {
    if (t.status !== 'complete') return;
    const name = t.employee?.full_name || 'Unassigned';
    perEmployee[name] = (perEmployee[name] || 0) + 1;
  });
  const empLabels = Object.keys(perEmployee);
  const empValues = Object.values(perEmployee);

  drawChart('chart-per-employee', 'bar', {
    labels: empLabels.length ? empLabels : ['No data yet'],
    datasets: [{
      data: empValues.length ? empValues : [0],
      backgroundColor: '#7C3AED',
      borderRadius: 6
    }]
  }, { plugins: { legend: { display: false } } });

  // ---- status breakdown (all tasks) ----
  const statusCounts = { New: 0, Accepted: 0, 'In Progress': 0, Overdue: 0, Complete: 0 };
  allTasksCache.forEach(t => {
    if (t.status === 'complete') { statusCounts.Complete++; return; }
    if (isPast(t.deadline)) { statusCounts.Overdue++; return; }
    if (t.status === 'in_progress') statusCounts['In Progress']++;
    else if (t.status === 'accepted') statusCounts.Accepted++;
    else statusCounts.New++;
  });

  drawChart('chart-status', 'doughnut', {
    labels: Object.keys(statusCounts),
    datasets: [{
      data: Object.values(statusCounts),
      backgroundColor: ['#DB2777', '#2563EB', '#C97F0A', '#B23A2E', '#3E7A5C']
    }]
  }, { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } });

  // ---- completions trend, last 14 days ----
  const dayLabels = [];
  const dayCounts = [];
  for (let i = 13; i >= 0; i--) {
    const day = addDays(new Date(), -i);
    day.setHours(0, 0, 0, 0);
    const next = addDays(day, 1);
    dayLabels.push(day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    dayCounts.push(allTasksCache.filter(t =>
      t.status === 'complete' && t.completed_at &&
      new Date(t.completed_at) >= day && new Date(t.completed_at) < next
    ).length);
  }

  drawChart('chart-trend', 'line', {
    labels: dayLabels,
    datasets: [{
      data: dayCounts,
      borderColor: '#4361EE',
      backgroundColor: 'rgba(67,97,238,.15)',
      fill: true,
      tension: 0.35,
      pointRadius: 3
    }]
  }, { plugins: { legend: { display: false } } });
}

function drawChart(canvasId, type, data, extraOptions) {
  const canvas = $(canvasId);
  if (!canvas) return;

  if (analyticsCharts[canvasId]) {
    analyticsCharts[canvasId].destroy();
  }

  const isDark = document.body.classList.contains('app-theme');
  const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  const tickColor = isDark ? '#93A4BC' : '#5B6472';

  analyticsCharts[canvasId] = new Chart(canvas, {
    type,
    data,
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      scales: (type === 'doughnut') ? {} : {
        x: { grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, precision: 0 }, beginAtZero: true }
      }
    }, extraOptions)
  });
}

// =========================================================
// DAILY MOTIVATION QUOTE (Hindi) — changes automatically each day
// =========================================================
const DAILY_QUOTES_HI = [
  { hi: "मेहनत का कोई विकल्प नहीं होता।", en: "There is no substitute for hard work." },
  { hi: "जो आज करना है, उसे कल पर मत टालो।", en: "Don't put off till tomorrow what you can do today." },
  { hi: "सफलता उन्हीं को मिलती है जो प्रयास करना नहीं छोड़ते।", en: "Success comes to those who never stop trying." },
  { hi: "कठिन परिश्रम ही सफलता की कुंजी है।", en: "Hard work is the key to success." },
  { hi: "छोटे-छोटे प्रयास ही बड़ी सफलता की नींव रखते हैं।", en: "Small efforts build the foundation of big success." },
  { hi: "अनुशासन ही आपको आपके लक्ष्य तक पहुँचाता है।", en: "Discipline is what takes you to your goal." },
  { hi: "हर दिन एक नया अवसर है खुद को बेहतर बनाने का।", en: "Every day is a new chance to become better." },
  { hi: "टीम वर्क से असंभव भी संभव हो जाता है।", en: "Teamwork makes the impossible possible." },
  { hi: "समय का सही उपयोग ही सबसे बड़ी सफलता है।", en: "Using time wisely is the greatest success." },
  { hi: "जो सीखना नहीं छोड़ता, वह हारना नहीं जानता।", en: "One who never stops learning never knows defeat." },
  { hi: "आत्मविश्वास ही आधी सफलता है।", en: "Self-confidence is half the success." },
  { hi: "आज का काम आज ही पूरा करें।", en: "Finish today's work today." },
  { hi: "एक कदम भी आगे बढ़ाना, न बढ़ने से बेहतर है।", en: "One step forward is better than no step at all." },
  { hi: "मुश्किलें ही हमें मजबूत बनाती हैं।", en: "Difficulties are what make us strong." },
  { hi: "जिम्मेदारी निभाना ही असली नेतृत्व है।", en: "Fulfilling responsibility is true leadership." },
  { hi: "बड़ा सोचो, मेहनत करो, सफलता खुद आएगी।", en: "Think big, work hard, success will follow." },
  { hi: "हर समस्या का समाधान धैर्य में छिपा है।", en: "Patience holds the solution to every problem." },
  { hi: "खुद पर भरोसा रखो, रास्ता खुद बन जाएगा।", en: "Trust yourself, the way will find itself." },
  { hi: "गुणवत्ता में समझौता कभी मत करो।", en: "Never compromise on quality." },
  { hi: "जो लक्ष्य के लिए मेहनत करता है, वही जीतता है।", en: "Whoever works hard for a goal, wins it." },
  { hi: "आज की छोटी कोशिश, कल की बड़ी कामयाबी है।", en: "Today's small effort is tomorrow's big achievement." },
  { hi: "काम में ईमानदारी सबसे बड़ा गुण है।", en: "Honesty in work is the greatest virtue." },
  { hi: "हार मत मानो, रास्ते खुद बनते जाएंगे।", en: "Don't give up, the paths will form on their own." },
  { hi: "सही दिशा में उठाया गया एक कदम, मंज़िल के करीब ले जाता है।", en: "One step in the right direction brings you closer to the goal." },
  { hi: "जो वक्त की कदर करता है, वक्त उसकी कदर करता है।", en: "Time values those who value time." },
  { hi: "प्रयास करने वालों की कभी हार नहीं होती।", en: "Those who keep trying never truly lose." },
  { hi: "काम को प्यार से करो, नतीजे खुद बेहतर होंगे।", en: "Do your work with love, the results will follow." },
  { hi: "हर सुबह एक नई शुरुआत का मौका देती है।", en: "Every morning offers a chance for a new beginning." },
  { hi: "योजना बनाओ, मेहनत करो, फिर सफलता का इंतज़ार मत करो — वह खुद आएगी।", en: "Plan, work hard, and don't wait for success — it will come on its own." },
  { hi: "आपकी मेहनत ही आपकी सबसे बड़ी पहचान है।", en: "Your hard work is your greatest identity." }
];

function renderDailyQuote() {
  const hiEl = $('daily-quote-hi');
  const enEl = $('daily-quote-en');
  if (!hiEl) return;

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24));
  const quote = DAILY_QUOTES_HI[dayOfYear % DAILY_QUOTES_HI.length];

  hiEl.textContent = quote.hi;
  if (enEl) enEl.textContent = quote.en;
}

// =========================================================
// FILE UPLOAD HELPER (shared by comments + My Files)
// =========================================================
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

function classifyFile(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  return null;
}

async function uploadFileToStorage(file, pathPrefix) {
  const kind = classifyFile(file);
  if (!kind) {
    throw new Error('Only images or PDF files are supported.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('That file is too large — please keep it under 8 MB.');
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${pathPrefix}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await sb.storage.from('attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });
  if (uploadError) throw uploadError;

  const { data: pub } = sb.storage.from('attachments').getPublicUrl(path);

  return { url: pub.publicUrl, name: file.name, type: kind, path };
}

// =========================================================
// TASK COMMENTS (boss <-> employee chat, per task)
// =========================================================
let currentCommentsTaskId = null;
let pendingCommentAttachment = null; // { file, kind } chosen but not yet uploaded

$('comments-close').addEventListener('click', () => {
  $('comments-modal').classList.add('hidden');
  currentCommentsTaskId = null;
  pendingCommentAttachment = null;
});

async function openCommentsModal(taskId, taskTitle) {
  currentCommentsTaskId = taskId;
  pendingCommentAttachment = null;
  $('comments-title').textContent = `Comments — ${taskTitle}`;
  $('comment-message').value = '';
  $('comment-file').value = '';
  $('comment-msg').textContent = '';
  $('comment-attachment-preview').classList.add('hidden');
  $('comment-attachment-preview').innerHTML = '';
  $('comments-modal').classList.remove('hidden');
  await loadComments(taskId);
}

async function loadComments(taskId, listId = 'comments-list') {
  const list = $(listId);
  list.innerHTML = '<p style="color:#5B6472;font-style:italic;">Loading...</p>';

  const { data, error } = await sb
    .from('task_comments')
    .select('*, author_profile:profiles!task_comments_author_fkey(full_name)')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });

  if (error) {
    list.innerHTML = `<p style="color:var(--red);">Could not load comments: ${escapeHtml(error.message)}${error.message.includes('does not exist') ? ' — have you run supabase-migration-v3.sql yet?' : ''}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<p style="color:#5B6472;font-style:italic;">No comments yet — start the conversation below.</p>';
    return;
  }

  list.innerHTML = data.map(c => {
    const mine = c.author === currentUser.id;
    const when = new Date(c.created_at).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    let attachmentHtml = '';
    if (c.attachment_url) {
      if (c.attachment_type === 'image') {
        attachmentHtml = `<a href="${c.attachment_url}" target="_blank" rel="noopener"><img src="${c.attachment_url}" class="comment-attachment-img" alt="${escapeHtml(c.attachment_name || 'attachment')}"></a>`;
      } else {
        attachmentHtml = `<a href="${c.attachment_url}" target="_blank" rel="noopener" class="comment-attachment-file">📄 ${escapeHtml(c.attachment_name || 'file.pdf')}</a>`;
      }
    }
    return `
      <div class="comment-bubble ${mine ? 'mine' : ''}">
        <div class="comment-author">${escapeHtml(c.author_profile?.full_name || 'Someone')} <span class="comment-time">${when}</span></div>
        ${c.message ? `<div class="comment-text">${escapeHtml(c.message)}</div>` : ''}
        ${attachmentHtml}
      </div>
    `;
  }).join('');

  list.scrollTop = list.scrollHeight;
}

$('comment-file').addEventListener('change', () => {
  const file = $('comment-file').files[0];
  const preview = $('comment-attachment-preview');
  if (!file) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
    pendingCommentAttachment = null;
    return;
  }
  const kind = classifyFile(file);
  if (!kind) {
    $('comment-msg').textContent = 'Only images or PDF files are supported.';
    $('comment-msg').className = 'msg err';
    $('comment-file').value = '';
    return;
  }
  pendingCommentAttachment = file;
  preview.classList.remove('hidden');
  preview.innerHTML = `${kind === 'image' ? '🖼️' : '📄'} ${escapeHtml(file.name)} <button type="button" class="btn-text-small" id="comment-attachment-remove">Remove</button>`;
  $('comment-attachment-remove').addEventListener('click', () => {
    pendingCommentAttachment = null;
    $('comment-file').value = '';
    preview.classList.add('hidden');
    preview.innerHTML = '';
  });
});

$('comment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('comment-msg');
  msg.textContent = '';
  msg.className = 'msg';

  const message = $('comment-message').value.trim();
  if (!message && !pendingCommentAttachment) {
    msg.textContent = 'Write something or attach a file first.';
    msg.className = 'msg err';
    return;
  }

  const sendBtn = e.target.querySelector('button[type="submit"]');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  let attachment = null;
  try {
    if (pendingCommentAttachment) {
      attachment = await uploadFileToStorage(pendingCommentAttachment, `task-comments/${currentCommentsTaskId}`);
    }
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg err';
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    return;
  }

  const { error } = await sb.from('task_comments').insert({
    task_id: currentCommentsTaskId,
    author: currentUser.id,
    message: message || null,
    attachment_url: attachment?.url || null,
    attachment_name: attachment?.name || null,
    attachment_type: attachment?.type || null
  });

  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  $('comment-message').value = '';
  $('comment-file').value = '';
  pendingCommentAttachment = null;
  $('comment-attachment-preview').classList.add('hidden');
  $('comment-attachment-preview').innerHTML = '';
  await loadComments(currentCommentsTaskId);

  const t = allTasksCache.find(x => x.id === currentCommentsTaskId);
  if (t) {
    const recipient = currentProfile.role === 'boss' ? t.assigned_to : await getBossId();
    if (recipient && recipient !== currentUser.id) {
      await createNotification(recipient, 'comment', 'New comment', `${currentProfile.full_name} commented on: "${t.title}"`, t.id);
    }
  }
});

// =========================================================
// MY FILES — employee's private upload locker
// =========================================================
async function loadMyFiles() {
  const grid = $('my-files-grid');
  if (!grid) return; // only exists on the employee dashboard

  const { data, error } = await sb
    .from('employee_files')
    .select('*')
    .eq('employee_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    grid.innerHTML = `<p class="notice-empty">Couldn't load your files${error.message.includes('does not exist') ? ' — this feature needs supabase-migration-v3.sql run first' : ''}.</p>`;
    $('my-files-count').textContent = '0';
    return;
  }

  $('my-files-count').textContent = data.length;

  if (data.length === 0) {
    grid.innerHTML = '<p class="notice-empty">Nothing uploaded yet.</p>';
    return;
  }

  grid.innerHTML = data.map(f => `
    <div class="my-file-card">
      ${f.file_type === 'image'
        ? `<a href="${f.file_url}" target="_blank" rel="noopener"><img src="${f.file_url}" class="my-file-thumb" alt="${escapeHtml(f.file_name)}"></a>`
        : `<a href="${f.file_url}" target="_blank" rel="noopener" class="my-file-icon">📄</a>`
      }
      <div class="my-file-info">
        <div class="my-file-name" title="${escapeHtml(f.file_name)}">${escapeHtml(f.file_name)}</div>
        ${f.note ? `<div class="my-file-note">${escapeHtml(f.note)}</div>` : ''}
        <div class="my-file-date">${formatDate(f.created_at)}</div>
      </div>
      <button class="btn-text-small" data-delete-file="${f.id}" data-file-name="${escapeHtml(f.file_name)}">Delete</button>
    </div>
  `).join('');

  grid.querySelectorAll('button[data-delete-file]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = confirm(`Delete "${btn.dataset.fileName}"? This can't be undone.`);
      if (!ok) return;
      btn.disabled = true;
      const { error } = await sb.from('employee_files').delete().eq('id', btn.dataset.deleteFile);
      if (error) { alert('Could not delete: ' + error.message); btn.disabled = false; return; }
      await loadMyFiles();
    });
  });
}

const myFileForm = $('my-file-form');
if (myFileForm) {
  myFileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('my-file-msg');
    msg.textContent = '';
    msg.className = 'msg';

    const file = $('my-file-input').files[0];
    const note = $('my-file-note').value.trim();
    if (!file) {
      msg.textContent = 'Choose a file first.';
      msg.className = 'msg err';
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    try {
      const uploaded = await uploadFileToStorage(file, `employee-files/${currentUser.id}`);
      const { error } = await sb.from('employee_files').insert({
        employee_id: currentUser.id,
        file_url: uploaded.url,
        file_name: uploaded.name,
        file_type: uploaded.type,
        note: note || null
      });
      if (error) throw error;

      msg.textContent = 'Uploaded.';
      msg.className = 'msg ok';
      e.target.reset();
      await loadMyFiles();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'msg err';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
    }
  });
}

// =========================================================
// PRESENCE — "online now" / "last seen" tracking
//
// Supabase Auth's own last-sign-in log isn't safely readable from the
// browser with the app's public key (that needs an admin key, which must
// never be shipped client-side). Instead we track a simple last_seen_at
// timestamp on each profile, refreshed every ~45s while the dashboard is
// open — this also captures "still active" more usefully than a one-time
// login timestamp would.
// =========================================================
let presenceHeartbeatId = null;

async function updateLastSeen() {
  if (!currentUser) return;
  const now = new Date().toISOString();
  const { error } = await sb.from('profiles').update({ last_seen_at: now }).eq('id', currentUser.id);
  if (error) {
    console.error('Could not update last_seen_at (check that supabase-migration-v5.sql has been run):', error.message);
    return;
  }
  if (currentProfile) currentProfile.last_seen_at = now;
}

async function refreshPresenceDisplays() {
  if (!currentProfile) return;
  if (currentProfile.role === 'boss') {
    await loadEmployees();
  } else {
    const { data: dir } = await sb
      .from('profiles')
      .select('id, full_name, last_seen_at')
      .eq('role', 'employee');
    employeeDirectoryCache = dir || [];
    renderTeamStatus();
    renderMyIdCard();
  }
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  updateLastSeen();
  presenceHeartbeatId = setInterval(async () => {
    await updateLastSeen();
    await refreshPresenceDisplays();
  }, 45000);
}

function stopPresenceHeartbeat() {
  if (presenceHeartbeatId) {
    clearInterval(presenceHeartbeatId);
    presenceHeartbeatId = null;
  }
}

function getOnlineStatus(lastSeenAt) {
  if (!lastSeenAt) return { online: false, label: 'Offline' };
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return { online: true, label: 'Online now' };
  if (mins < 60) return { online: false, label: `Last seen ${mins}m ago` };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { online: false, label: `Last seen ${hours}h ago` };
  const days = Math.floor(hours / 24);
  return { online: false, label: `Last seen ${days}d ago` };
}

function renderTeamStatus() {
  const list = $('team-status-list');
  const tag = $('team-status-count');
  if (!list) return;

  const others = employeeDirectoryCache.filter(e => e.id !== currentUser.id);
  tag.textContent = employeeDirectoryCache.length;

  if (others.length === 0) {
    list.innerHTML = '<p class="notice-empty">No other teammates yet.</p>';
    return;
  }

  const sorted = [...others].sort((a, b) => {
    const aOnline = getOnlineStatus(a.last_seen_at).online;
    const bOnline = getOnlineStatus(b.last_seen_at).online;
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  list.innerHTML = sorted.map(e => {
    const status = getOnlineStatus(e.last_seen_at);
    const taskCount = allTasksCache.filter(t => t.assigned_to === e.id && t.status !== 'complete').length;
    return `
      <div class="team-status-row" data-employee-id="${e.id}" data-employee-name="${escapeHtml(e.full_name)}">
        <span class="chip ${getAvatarColorClass(e.full_name)}">${getInitials(e.full_name)}</span>
        <span class="team-status-name">${escapeHtml(e.full_name)}</span>
        <span class="team-status-badge ${status.online ? 'online' : ''}">
          <span class="ic-status-dot ${status.online ? '' : 'offline'}"></span>${escapeHtml(status.label)}
        </span>
        <span class="team-status-taskcount">${taskCount} task${taskCount === 1 ? '' : 's'}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.team-status-row').forEach(row => {
    row.addEventListener('click', () => {
      openFullTasksModal(row.dataset.employeeId, row.dataset.employeeName);
    });
  });
}

// =========================================================
// HOLIDAY CALENDAR (employee dashboard widget)
// Transcribed from the official 2026 public/restricted holiday circular.
// When next year's circular comes out, add a new year block here.
// =========================================================
const HOLIDAYS_2026 = [
  // ---- Public holidays (सार्वजनिक अवकाश) ----
  { date: '2026-01-03', name: 'मो. हजरत अली का जन्म दिवस', type: 'public' },
  { date: '2026-01-26', name: 'गणतन्त्र दिवस', type: 'public' },
  { date: '2026-02-15', name: 'महाशिवरात्रि', type: 'public' },
  { date: '2026-03-02', name: 'होलिका दहन', type: 'public' },
  { date: '2026-03-04', name: 'होली', type: 'public' },
  { date: '2026-03-21', name: 'ईद-उल-फितर', type: 'public' },
  { date: '2026-03-26', name: 'रामनवमी', type: 'public' },
  { date: '2026-03-31', name: 'महावीर जयन्ती', type: 'public' },
  { date: '2026-04-03', name: 'गुड फ्राइडे', type: 'public' },
  { date: '2026-04-14', name: 'डॉ. भीमराव अम्बेडकर जी का जन्म दिवस', type: 'public' },
  { date: '2026-05-01', name: 'बुद्ध पूर्णिमा', type: 'public' },
  { date: '2026-05-27', name: 'ईद-उल-जुहा (बकरीद)', type: 'public' },
  { date: '2026-06-26', name: 'मोहर्रम', type: 'public' },
  { date: '2026-08-15', name: 'स्वतंत्रता दिवस', type: 'public' },
  { date: '2026-08-26', name: 'ईद-ए-मिलाद/बारावफात', type: 'public' },
  { date: '2026-08-28', name: 'रक्षा बन्धन', type: 'public' },
  { date: '2026-09-04', name: 'जन्माष्टमी', type: 'public' },
  { date: '2026-10-02', name: 'महात्मा गाँधी जयन्ती', type: 'public' },
  { date: '2026-10-20', name: 'दशहरा महानवमी/विजयदशमी', type: 'public' },
  { date: '2026-11-08', name: 'दीपावली', type: 'public' },
  { date: '2026-11-09', name: 'गोवर्धन पूजा', type: 'public' },
  { date: '2026-11-11', name: 'भैया दूज/चित्रगुप्त जयन्ती', type: 'public' },
  { date: '2026-11-24', name: 'गुरूनानक जयन्ती/कार्तिक पूर्णिमा', type: 'public' },
  { date: '2026-12-25', name: 'क्रिसमस डे', type: 'public' },

  // ---- Restricted holidays (निर्बन्धित अवकाश) ----
  { date: '2026-01-01', name: 'नववर्ष दिवस', type: 'restricted' },
  { date: '2026-01-14', name: 'मकर संक्रान्ति', type: 'restricted' },
  { date: '2026-01-23', name: 'वसन्त पंचमी', type: 'restricted' },
  { date: '2026-01-24', name: 'जननायक कर्पूरी ठाकुर का जन्म दिवस', type: 'restricted' },
  { date: '2026-02-01', name: 'सन्त रविदास जयन्ती', type: 'restricted' },
  { date: '2026-02-04', name: 'शवे बरात', type: 'restricted' },
  { date: '2026-03-05', name: 'होली (द्वितीय दिवस)', type: 'restricted' },
  { date: '2026-03-13', name: 'जमात-उल-विदा (अलविदा)', type: 'restricted' },
  { date: '2026-03-19', name: 'चेटीचंद जयन्ती', type: 'restricted' },
  { date: '2026-03-22', name: 'ईद-उल-फितर (द्वितीय दिवस)', type: 'restricted' },
  { date: '2026-04-04', name: 'ईस्टर सैटरडे', type: 'restricted' },
  { date: '2026-04-05', name: 'महर्षि कश्यप एवं महाराजा निषाद राज गुह्य जयन्ती', type: 'restricted' },
  { date: '2026-04-06', name: 'ईस्टर मन्डे', type: 'restricted' },
  { date: '2026-04-17', name: 'चन्द्रशेखर जयन्ती', type: 'restricted' },
  { date: '2026-04-19', name: 'परशुराम जयन्ती', type: 'restricted' },
  { date: '2026-05-09', name: 'लोकनायक महाराणा प्रताप जयन्ती', type: 'restricted' },
  { date: '2026-05-28', name: 'ईद-उल-जुहा (बकरीद, द्वितीय दिवस)', type: 'restricted' },
  { date: '2026-06-25', name: 'मोहर्रम (प्रथम दिवस)', type: 'restricted' },
  { date: '2026-08-04', name: 'चेहल्लुम', type: 'restricted' },
  { date: '2026-09-17', name: 'विश्वकर्मा पूजा', type: 'restricted' },
  { date: '2026-09-25', name: 'अनन्त चतुर्दशी', type: 'restricted' },
  { date: '2026-10-11', name: 'महाराजा अग्रसेन जयन्ती', type: 'restricted' },
  { date: '2026-10-19', name: 'दशहरा (महाष्टमी)', type: 'restricted' },
  { date: '2026-10-26', name: 'महर्षि वाल्मीकि जयन्ती', type: 'restricted' },
  { date: '2026-10-31', name: 'सरदार वल्लभ भाई पटेल एवं आचार्य नरेन्द्र देव जयन्ती', type: 'restricted' },
  { date: '2026-11-08', name: 'नरक चतुर्दशी', type: 'restricted' },
  { date: '2026-11-15', name: 'छठ पूजा पर्व', type: 'restricted' },
  { date: '2026-11-16', name: 'वीरांगना उदा देवी शहीद दिवस', type: 'restricted' },
  { date: '2026-12-16', name: 'हजरत ख्वाजा मुइनुद्दीन चिश्ती की उर्स/अजमेरी गरीब नवाज जयन्ती', type: 'restricted' },
  { date: '2026-12-23', name: 'चौधरी चरण सिंह का जन्म दिवस', type: 'restricted' },
  { date: '2026-12-24', name: 'क्रिसमस ईव', type: 'restricted' }
];

function getWeeklyOffs(year) {
  const offs = [];
  const d = new Date(year, 0, 1);
  const satCountByMonth = {};

  while (d.getFullYear() === year) {
    const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
    if (dow === 0) {
      offs.push({ date: toDateStr(d), name: 'साप्ताहिक अवकाश (रविवार)', type: 'weekly' });
    } else if (dow === 6) {
      const key = d.getMonth();
      satCountByMonth[key] = (satCountByMonth[key] || 0) + 1;
      if (satCountByMonth[key] === 2) {
        offs.push({ date: toDateStr(d), name: 'द्वितीय शनिवार', type: 'weekly' });
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return offs;
}

function getAllHolidays(year) {
  const fixed = HOLIDAYS_2026.filter(h => h.date.startsWith(String(year)));
  const known = new Set(fixed.map(h => h.date));
  const weekly = getWeeklyOffs(year).filter(h => !known.has(h.date));
  return [...fixed, ...weekly].sort((a, b) => a.date.localeCompare(b.date));
}

let holidayListExpanded = false;
function renderHolidayWidget() {
  const nextEl = $('holiday-next');
  const listEl = $('holiday-list');
  if (!nextEl || !listEl) return;

  const todayStr = toDateStr(new Date());
  const year = new Date().getFullYear();

  let all = getAllHolidays(year);
  // roll into next year too, near year-end, so "next holiday" doesn't run dry in December
  if (new Date().getMonth() >= 10) {
    all = all.concat(getAllHolidays(year + 1));
  }

  const upcoming = all.filter(h => h.date >= todayStr);

  if (upcoming.length === 0) {
    nextEl.innerHTML = 'No upcoming holidays found.';
  } else {
    const next = upcoming[0];
    const days = Math.round((parseDateStr(next.date) - parseDateStr(todayStr)) / (1000 * 60 * 60 * 24));
    const dayLabel = days === 0 ? 'Today! 🎊' : days === 1 ? 'Tomorrow' : `in ${days} days`;
    nextEl.innerHTML = `
      <span class="hn-days">${dayLabel}</span>
      <span class="hn-name">${escapeHtml(next.name)}</span>
      <span class="hn-date">${formatDate(next.date)}</span>
    `;
  }

  const typeLabel = { public: 'Public', restricted: 'Restricted', weekly: 'Weekly Off' };
  const showAll = holidayListExpanded;
  const visible = showAll ? upcoming.slice(0, 40) : upcoming.slice(0, 4);

  listEl.innerHTML = visible.map(h => `
    <div class="holiday-row ${h.type}">
      <div class="hr-date">${formatDate(h.date)}</div>
      <div class="hr-info">
        <div class="hr-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</div>
        <div class="hr-type">${typeLabel[h.type] || h.type}</div>
      </div>
    </div>
  `).join('');

  const btn = $('holiday-view-all-btn');
  if (btn) btn.textContent = showAll ? '← Show less' : 'View Full Calendar →';
}

// =========================================================
// PUSH NOTIFICATIONS (real OS/browser push, works even when the tab
// is closed — separate from the in-app realtime bell above)
// =========================================================
const VAPID_PUBLIC_KEY = 'BKle4evP6tzv417Bo9ymeWGi24RQwm2o3sUCSCqXZngCTj1QjQ1_W79ii9KegLBxsI_l0-EOPSUKklDrjxwEevQ';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('Service worker registration failed (this is fine if you have not set up sw.js yet):', e.message);
    return null;
  }
}

async function getExistingPushSubscription() {
  if (!pushSupported()) return null;
  try {
    // getRegistration() resolves immediately either way — unlike
    // navigator.serviceWorker.ready, which NEVER resolves if no service
    // worker has successfully registered (e.g. sw.js isn't uploaded yet),
    // and previously froze the whole dashboard behind it.
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) {
    alert("This browser doesn't support push notifications.");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Notifications were not allowed — you can enable them later in your browser/site settings.');
    return false;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    alert("Push setup isn't ready yet on this site (sw.js may not be uploaded, or the Edge Function hasn't been deployed). See PUSH_SETUP.md.");
    return false;
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }

  const json = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: currentUser.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth
  }, { onConflict: 'endpoint' });

  if (error) {
    console.error('Could not save push subscription (has supabase-migration-v8.sql been run?):', error.message);
    return false;
  }
  return true;
}

async function updatePushButtonState() {
  const btn = $('notif-push-btn');
  if (!btn || !pushSupported()) { if (btn) btn.classList.add('hidden'); return; }

  const sub = await getExistingPushSubscription();
  if (sub && Notification.permission === 'granted') {
    btn.textContent = '🔔 Push notifications on';
    btn.classList.add('enabled');
  } else {
    btn.textContent = '🔕 Enable push notifications';
    btn.classList.remove('enabled');
  }
}

// wraps push setup with both a try/catch AND a hard timeout — belt and
// braces so a browser quirk here can never again freeze the dashboard
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}
async function initPushNotifications() {
  try {
    await withTimeout(registerServiceWorker(), 4000);
    await withTimeout(updatePushButtonState(), 4000);
  } catch (e) {
    console.warn('Push notification setup skipped:', e.message);
  }
}


let cachedBossId = null;
let cachedBossName = null;
async function getBossId() {
  if (cachedBossId) return cachedBossId;
  const { data } = await sb.from('profiles').select('id, full_name').eq('role', 'boss').limit(1).maybeSingle();
  cachedBossId = data?.id || null;
  cachedBossName = data?.full_name || 'Boss';
  return cachedBossId;
}

async function createNotification(userId, type, title, message, taskId) {
  if (!userId) return;
  const { error } = await sb.from('notifications').insert({
    user_id: userId, type, title, message: message || null, task_id: taskId || null
  });
  if (error) console.error('Could not create notification (has supabase-migration-v7.sql been run?):', error.message);
}

async function notifyBoss(type, title, message, taskId) {
  const bossId = await getBossId();
  if (bossId) await createNotification(bossId, type, title, message, taskId);
}

let notificationsCache = [];
let notifRealtimeChannel = null;

async function loadNotifications() {
  if (!currentUser) return;
  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) {
    console.error('Could not load notifications (has supabase-migration-v7.sql been run?):', error.message);
    return;
  }
  notificationsCache = data || [];
  renderNotificationBell();
}

const NOTIF_ICON = {
  task_assigned: '🔴', task_accepted: '🟢', task_started: '🟡', task_completed: '🟢',
  comment: '💬', deadline_tomorrow: '🟡', overdue: '⚠️', employee_added: '🔵'
};

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr.slice(0, 10));
}

function renderNotificationBell() {
  const badge = $('notif-badge');
  const list = $('notif-list');
  if (!badge || !list) return;

  const unread = notificationsCache.filter(n => !n.read).length;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);

  if (notificationsCache.length === 0) {
    list.innerHTML = '<p class="notif-empty">No notifications yet.</p>';
    return;
  }

  list.innerHTML = notificationsCache.map(n => `
    <div class="notif-row ${n.read ? '' : 'unread'}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}">
      <span class="notif-icon">${NOTIF_ICON[n.type] || '🔔'}</span>
      <div class="notif-info">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        ${n.message ? `<div class="notif-message">${escapeHtml(n.message)}</div>` : ''}
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.notif-row').forEach(row => {
    row.addEventListener('click', async () => {
      const id = row.dataset.notifId;
      const taskId = row.dataset.taskId;
      const n = notificationsCache.find(x => x.id === id);
      if (n && !n.read) {
        n.read = true;
        renderNotificationBell();
        await sb.from('notifications').update({ read: true }).eq('id', id);
      }
      if (taskId) {
        const t = allTasksCache.find(x => x.id === taskId);
        $('notif-panel').classList.add('hidden');
        openCommentsModal(taskId, t?.title || 'Task');
      }
    });
  });
}

$('notif-bell-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('notif-panel').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.notif-bell-wrap');
  if (wrap && !wrap.contains(e.target)) $('notif-panel').classList.add('hidden');
});
$('notif-mark-all-read').addEventListener('click', async (e) => {
  e.stopPropagation();
  const unreadIds = notificationsCache.filter(n => !n.read).map(n => n.id);
  if (unreadIds.length === 0) return;
  notificationsCache.forEach(n => { n.read = true; });
  renderNotificationBell();
  await sb.from('notifications').update({ read: true }).in('id', unreadIds);
});

$('notif-push-btn').addEventListener('click', async (e) => {
  e.stopPropagation();
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Setting up...';
  await enablePushNotifications();
  await updatePushButtonState();
  btn.disabled = false;
});

function startNotificationRealtime() {
  stopNotificationRealtime();
  notifRealtimeChannel = sb.channel('notifications-' + currentUser.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, (payload) => {
      notificationsCache.unshift(payload.new);
      renderNotificationBell();
    })
    .subscribe();
}
function stopNotificationRealtime() {
  if (notifRealtimeChannel) { sb.removeChannel(notifRealtimeChannel); notifRealtimeChannel = null; }
}

// deadline-tomorrow / overdue alerts — generated on load since there's no
// server-side cron available; each fires at most once per task
async function checkDeadlineNotifications() {
  if (!currentUser || currentProfile?.role !== 'employee') return;

  const tomorrow = toDateStr(addDays(new Date(), 1));
  const myOpenTasks = allTasksCache.filter(t => t.assigned_to === currentUser.id && t.status !== 'complete');

  for (const t of myOpenTasks) {
    if (t.deadline === tomorrow) {
      const exists = notificationsCache.some(n => n.task_id === t.id && n.type === 'deadline_tomorrow');
      if (!exists) await createNotification(currentUser.id, 'deadline_tomorrow', 'Deadline tomorrow', `"${t.title}" is due tomorrow`, t.id);
    } else if (isOverdue(t)) {
      const exists = notificationsCache.some(n => n.task_id === t.id && n.type === 'overdue');
      if (!exists) await createNotification(currentUser.id, 'overdue', 'Task overdue', `"${t.title}" is now overdue`, t.id);
    }
  }
}

// =========================================================
// APP SHELL — sidebar navigation + page switching (Batch 1)
// =========================================================
const SIDEBAR_NAV = {
  boss: [
    { page: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { page: 'tasks', label: 'Tasks', icon: '📋' },
    { page: 'employees', label: 'Employees', icon: '👥' }
  ],
  employee: [
    { page: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { page: 'inbox', label: 'Work Inbox', icon: '📥', badgeId: 'my-task-count' },
    { page: 'files', label: 'My Files', icon: '📄' },
    { page: 'tools', label: 'Tools', icon: '🛠️' }
  ]
};

let currentAppPage = 'dashboard';

function showPage(pageName) {
  currentAppPage = pageName;
  document.querySelectorAll('.app-page').forEach(el => {
    el.classList.toggle('active', el.dataset.pageGroup === pageName);
  });
  document.querySelectorAll('.sidebar-nav-btn[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageName);
  });

  const role = currentProfile?.role === 'boss' ? 'boss' : 'employee';
  const navItem = (SIDEBAR_NAV[role] || []).find(n => n.page === pageName);
  $('app-title').textContent = navItem ? navItem.label : 'Dashboard';

  // close the mobile sidebar after navigating
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('open');
}

function renderSidebarNav() {
  const role = currentProfile?.role === 'boss' ? 'boss' : 'employee';
  const items = SIDEBAR_NAV[role];
  const nav = $('sidebar-nav');

  nav.innerHTML = items.map(item => `
    <button type="button" class="sidebar-nav-btn" data-page="${item.page}">
      <span class="snb-icon">${item.icon}</span><span class="snb-label">${item.label}</span>
      ${item.badgeId ? `<span class="snb-badge" id="snb-badge-${item.page}">0</span>` : ''}
    </button>
  `).join('') + `
    <button type="button" class="sidebar-nav-btn" id="sidebar-settings-btn">
      <span class="snb-icon">⚙️</span><span class="snb-label">Settings</span>
    </button>
  `;

  nav.querySelectorAll('.sidebar-nav-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  $('sidebar-settings-btn').addEventListener('click', () => $('change-pw-btn').click());

  $('sidebar-quick-create').classList.toggle('hidden', role !== 'boss');

  showPage('dashboard');
}

// keep the Work Inbox sidebar badge synced to the real task count
function updateSidebarInboxBadge() {
  const badge = $('snb-badge-inbox');
  const count = $('my-task-count');
  if (badge && count) badge.textContent = count.textContent;
}

// ---- mobile sidebar toggle ----
$('sidebar-toggle-btn').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
  $('sidebar-backdrop').classList.toggle('open');
});
$('sidebar-backdrop').addEventListener('click', () => {
  $('sidebar').classList.remove('open');
  $('sidebar-backdrop').classList.remove('open');
});

// ---- desktop sidebar collapse (260px <-> 80px) ----
$('sidebar-collapse-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const collapsed = $('sidebar').classList.toggle('collapsed');
  localStorage.setItem('eoffice-sidebar-collapsed', collapsed ? '1' : '0');
});
if (localStorage.getItem('eoffice-sidebar-collapsed') === '1') {
  $('sidebar').classList.add('collapsed');
}

// ---- Quick Create (boss only) ----
$('qc-new-task').addEventListener('click', () => {
  showPage('tasks');
  setTimeout(() => $('assign-title')?.focus(), 100);
});
$('qc-new-announcement').addEventListener('click', () => {
  showPage('dashboard');
  setTimeout(() => $('notice-title')?.focus(), 100);
});

// =========================================================
// GLOBAL SEARCH (topbar)
// =========================================================
const searchInput = $('global-search');
const searchResultsEl = $('search-results');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchResultsEl.classList.add('hidden'); return; }

  const results = [];

  allTasksCache.forEach(t => {
    if (t.title.toLowerCase().includes(q)) {
      results.push({ type: 'Task', label: t.title, action: () => {
        showPage(currentProfile.role === 'boss' ? 'tasks' : 'inbox');
        openCommentsModal(t.id, t.title);
      }});
    }
  });

  const empList = currentProfile?.role === 'boss' ? employeesCache : employeeDirectoryCache;
  (empList || []).forEach(e => {
    if (e.full_name.toLowerCase().includes(q)) {
      results.push({ type: 'Employee', label: e.full_name, action: () => {
        if (currentProfile.role === 'boss') {
          showPage('employees');
        } else {
          showPage('dashboard');
        }
      }});
    }
  });

  searchResultsEl.classList.remove('hidden');
  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-empty">No matches found.</div>';
    return;
  }

  searchResultsEl.innerHTML = results.slice(0, 8).map((r, i) => `
    <div class="search-result-row" data-idx="${i}">
      <span class="search-result-type">${r.type}</span>
      <span class="search-result-label">${escapeHtml(r.label)}</span>
    </div>
  `).join('');

  searchResultsEl.querySelectorAll('.search-result-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      results[i].action();
      searchResultsEl.classList.add('hidden');
      searchInput.value = '';
    });
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-search')) searchResultsEl.classList.add('hidden');
});

// ---- Tools & Utilities footer (dashboard) ----
document.querySelectorAll('.tu-btn[data-tu-page]').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.tuPage));
});
const tuSettingsBtn = $('tu-settings-btn');
if (tuSettingsBtn) tuSettingsBtn.addEventListener('click', () => $('change-pw-btn').click());
document.querySelectorAll('.tu-btn-soon').forEach(btn => {
  btn.addEventListener('click', () => alert('Coming soon!'));
});

boot();

