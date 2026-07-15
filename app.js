// =========================================================
// WORK ORDER — app logic
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
  document.body.classList.remove('employee-mode');
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

  if (profile.role === 'boss') {
    document.body.classList.remove('employee-mode');
    $('boss-view').classList.remove('hidden');
    $('employee-view').classList.add('hidden');
    $('app-title').textContent = 'Boss Dashboard';
    await loadBossData();
  } else {
    document.body.classList.add('employee-mode');
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
  await Promise.all([loadEmployees(), loadTasks(), loadNotices()]);
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
        <div class="ic-content">
          <div class="ic-top">
            <div class="ic-avatar">${getInitials(emp.full_name)}</div>
            <button class="ic-remove" data-remove-emp="${emp.id}" data-emp-name="${escapeHtml(emp.full_name)}">Remove</button>
          </div>
          <div class="ic-code">${employeeCode(emp)}</div>
          <div class="ic-name">${escapeHtml(emp.full_name)}</div>
          ${emp.designation ? `<div class="ic-row ic-designation"><span class="ic-icon">💼</span>${escapeHtml(emp.designation)}</div>` : ''}
          <div class="ic-row"><span class="ic-icon">📧</span>${escapeHtml(emp.email || '—')}</div>
          <div class="ic-row"><span class="ic-icon">📱</span>${escapeHtml(emp.mobile || '—')}</div>
          <div class="ic-footer"><span class="ic-status-dot"></span>Active</div>
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
        <button class="btn-danger-text" data-delete-task="${t.id}" data-task-title="${escapeHtml(t.title)}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openHistoryModal(btn.dataset.history, btn.dataset.title));
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

  msg.textContent = 'Task assigned.';
  msg.className = 'msg ok';
  e.target.reset();
  await loadTasks();
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
  doc.text('Work Order — Task Report', 14, 16);
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
  const { data: dir } = await sb
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'employee');
  employeeDirectoryCache = dir || [];

  await loadNotices();
  renderMyIdCard();
  renderMyTickets(allTasksCache);
}

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
        ${currentProfile.designation ? `<div class="ic-row ic-designation"><span class="ic-icon">💼</span>${escapeHtml(currentProfile.designation)}</div>` : ''}
        <div class="mini-stats">
          <div class="m-stat"><div class="m-val">${completed}</div><div class="m-label">Completed</div></div>
          <div class="m-stat"><div class="m-val">${pending}</div><div class="m-label">Pending</div></div>
          <div class="m-stat"><div class="m-val">${productivity}%</div><div class="m-label">Productivity</div></div>
        </div>
        <div class="ic-footer"><span class="ic-status-dot"></span>Active</div>
      </div>
    </div>
  `;
  attachCardTilt(strip.querySelector('.id-card'));
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
      <div style="margin-bottom:10px;"><button class="btn-text-small" data-history="${t.id}" data-title="${escapeHtml(t.title)}">View history</button></div>
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

boot();
