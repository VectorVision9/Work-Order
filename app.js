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
}
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
  $('who-label').textContent = `${profile.full_name} · ${profile.role.toUpperCase()}`;
  showApp();
  document.body.classList.add('app-theme');
  renderDailyQuote();
  startPresenceHeartbeat();

  if (profile.role === 'boss') {
    $('boss-view').classList.remove('hidden');
    $('employee-view').classList.add('hidden');
    $('app-title').textContent = 'Boss Dashboard';
    await loadBossData();
  } else {
    $('employee-view').classList.remove('hidden');
    $('boss-view').classList.add('hidden');
    $('app-title').textContent = 'My Tasks';
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
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No tasks match this view yet.</td></tr>';
    return;
  }

  rows.forEach(t => {
    const overdue = t.status === 'pending' && isPast(t.deadline);
    const badgeClass = t.status === 'complete' ? 'complete' : (overdue ? 'overdue' : 'pending');
    const badgeText = t.status === 'complete' ? 'Complete' : (overdue ? 'Overdue' : 'Pending');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(t.employee?.full_name || 'Unassigned')}</td>
      <td><strong>${escapeHtml(t.title)}</strong>${t.description ? `<div style="color:#5B6472;font-size:12px;margin-top:4px;">${escapeHtml(t.description)}</div>` : ''}</td>
      <td>${formatDate(t.deadline)}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
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
    status: 'pending'
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
    const overdue = t.status === 'pending' && isPast(t.deadline);
    const statusLabel = t.status === 'complete' ? 'Complete' : (overdue ? 'Overdue' : 'Pending');
    return [
      t.employee?.full_name || 'Unassigned',
      t.title,
      formatDate(t.deadline),
      statusLabel,
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

  noticesCache.forEach(n => {
    const when = new Date(n.created_at).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    const card = document.createElement('div');
    card.className = 'notice-card' + (n.pinned ? ' pinned' : '');
    card.innerHTML = `
      <div class="n-top">
        <div class="n-title">${n.pinned ? '<span class="n-pin">📌</span>' : ''}${escapeHtml(n.title)}</div>
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

  const { error } = await sb.from('notices').insert({
    title, message, pinned,
    created_by: currentUser.id
  });

  if (error) {
    msg.textContent = error.message;
    msg.className = 'msg err';
    return;
  }

  msg.textContent = 'Notice posted.';
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
  renderMyTickets(filterClipboardTasks(allTasksCache));
  renderEmployeeOfMonth();
  renderTeamStatus();
  renderHolidayWidget();
  await loadMyFiles();
}

// keeps the shared clipboard from growing forever — show what still needs
// doing, plus a short recent-activity window, and nothing older than that
function filterClipboardTasks(tasks) {
  const RECENT_DAYS = 3;
  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return tasks.filter(t =>
    t.status === 'pending' ||
    (t.status === 'complete' && t.completed_at && new Date(t.completed_at).getTime() >= cutoff)
  );
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
      const overdue = t.status === 'pending' && isPast(t.deadline);
      const cls = t.status === 'complete' ? 'complete' : (overdue ? 'overdue' : 'pending');
      const badgeText = t.status === 'complete' ? 'Complete' : (overdue ? 'Overdue' : 'Pending');
      const metaText = t.status === 'complete'
        ? `Completed ${formatDate(t.completed_at)}`
        : `Due ${formatDate(t.deadline)}`;
      return `
        <div class="full-task-row ${cls}">
          <div class="ftr-info">
            <div class="ftr-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
            <div class="ftr-meta">${metaText}</div>
          </div>
          <span class="ftr-badge">${badgeText}</span>
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
  const pending = myTasks.filter(t => t.status === 'pending').length;
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

function renderMyTickets(tasks) {
  $('my-task-count').textContent = tasks.length;
  const grid = $('my-tickets');
  grid.innerHTML = '';

  if (tasks.length === 0) {
    grid.innerHTML = '<p style="color:#5B6472;font-style:italic;">No tasks on the clipboard yet.</p>';
    return;
  }

  tasks.forEach(t => {
    const overdue = t.status === 'pending' && isPast(t.deadline);
    const stampClass = t.status === 'complete' ? 'complete' : (overdue ? 'overdue' : 'pending');
    const stampText = t.status === 'complete' ? 'Complete' : (overdue ? 'Overdue' : 'Pending');
    const stampIcon = t.status === 'complete' ? '✅' : (overdue ? '⚠️' : '⏳');
    const isMine = t.assigned_to === currentUser.id;
    const assigneeName = isMine ? currentProfile.full_name : (t.employee?.full_name || 'someone else');

    const card = document.createElement('div');
    card.className = 'ticket status-' + stampClass + (isMine ? '' : ' readonly');
    card.innerHTML = `
      <div class="stamp ${stampClass}">${stampIcon} ${stampText}</div>
      <div class="assignee"><span class="chip">${getInitials(assigneeName)}</span>${isMine ? 'Assigned to you' : 'Assigned to ' + escapeHtml(t.employee?.full_name || 'someone else')}</div>
      <h3>${escapeHtml(t.title)}</h3>
      ${t.description ? `<p class="desc">${escapeHtml(t.description)}</p>` : ''}
      <div class="meta ${overdue ? 'overdue' : ''}">Deadline: ${formatDate(t.deadline)}</div>
      ${t.status === 'complete' ? `<div class="meta">Completed ${formatDate(t.completed_at)}</div>` : ''}
      <div style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn-text-small" data-history="${t.id}" data-title="${escapeHtml(t.title)}">View history</button>
        <button class="btn-text-small" data-comments="${t.id}" data-title="${escapeHtml(t.title)}">💬 Comments</button>
      </div>
      ${isMine && t.status === 'pending' ? `
        <div class="actions">
          <button class="btn-primary" data-complete="${t.id}">Mark complete</button>
          <button class="btn-secondary-small" data-reassign="${t.id}">Not related to me</button>
        </div>` : ''}
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('button[data-complete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Saving...';
      const { error } = await sb
        .from('tasks')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', btn.dataset.complete)
        .eq('assigned_to', currentUser.id);
      if (error) {
        alert('Could not update task: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Mark complete';
        return;
      }
      await loadEmployeeData();
    });
  });

  grid.querySelectorAll('button[data-reassign]').forEach(btn => {
    btn.addEventListener('click', () => openReassignModal(btn.dataset.reassign));
  });

  grid.querySelectorAll('button[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openHistoryModal(btn.dataset.history, btn.dataset.title));
  });

  grid.querySelectorAll('button[data-comments]').forEach(btn => {
    btn.addEventListener('click', () => openCommentsModal(btn.dataset.comments, btn.dataset.title));
  });
}

// ---------- "Not related to me" reassignment ----------
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
  const list = $('history-list');
  list.innerHTML = '<p style="color:#5B6472;font-style:italic;">Loading...</p>';
  $('history-modal').classList.remove('hidden');

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
    } else {
      line = `Reassigned from <strong>${escapeHtml(ev.from_profile?.full_name || '—')}</strong> to <strong>${escapeHtml(ev.to_profile?.full_name || '—')}</strong>`;
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
  const pending = myTasks.filter(t => t.status === 'pending').length;
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
        status: 'pending'
      }).select().single();

      if (!insertErr && inserted) {
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
  const overdueNow = allTasksCache.filter(t => t.status === 'pending' && isPast(t.deadline)).length;
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
  const statusCounts = { Pending: 0, Overdue: 0, Complete: 0 };
  allTasksCache.forEach(t => {
    if (t.status === 'complete') statusCounts.Complete++;
    else if (isPast(t.deadline)) statusCounts.Overdue++;
    else statusCounts.Pending++;
  });

  drawChart('chart-status', 'doughnut', {
    labels: Object.keys(statusCounts),
    datasets: [{
      data: Object.values(statusCounts),
      backgroundColor: ['#C97F0A', '#B23A2E', '#3E7A5C']
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

async function loadComments(taskId) {
  const list = $('comments-list');
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
  if (!lastSeenAt) return { online: false, label: 'Never logged in' };
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
    return `
      <div class="team-status-row" data-employee-id="${e.id}" data-employee-name="${escapeHtml(e.full_name)}">
        <span class="chip">${getInitials(e.full_name)}</span>
        <span class="team-status-name">${escapeHtml(e.full_name)}</span>
        <span class="team-status-badge ${status.online ? 'online' : ''}">
          <span class="ic-status-dot ${status.online ? '' : 'offline'}"></span>${escapeHtml(status.label)}
        </span>
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
  listEl.innerHTML = upcoming.slice(0, 40).map(h => `
    <div class="holiday-row ${h.type}">
      <div class="hr-date">${formatDate(h.date)}</div>
      <div class="hr-info">
        <div class="hr-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</div>
        <div class="hr-type">${typeLabel[h.type] || h.type}</div>
      </div>
    </div>
  `).join('');
}

boot();
