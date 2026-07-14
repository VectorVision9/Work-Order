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

// ---------- view switching ----------
function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
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
  await Promise.all([loadEmployees(), loadTasks()]);
}

async function loadEmployees() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('role', 'employee')
    .order('full_name');

  if (error) { console.error(error); return; }
  employeesCache = data || [];

  // employee list panel
  const list = $('employee-list');
  list.innerHTML = '';
  if (employeesCache.length === 0) {
    list.innerHTML = '<li style="color:#5B6472;font-style:italic;">No employees yet — add your first one below.</li>';
  } else {
    employeesCache.forEach(emp => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(emp.full_name)}</span><span style="display:flex;align-items:center;gap:12px;"><span class="e-email">${escapeHtml(emp.email || '')}</span><button class="btn-danger-text" data-remove-emp="${emp.id}" data-emp-name="${escapeHtml(emp.full_name)}">Remove</button></span>`;
      list.appendChild(li);
    });
  }
  $('employee-count-tag').textContent = employeesCache.length;

  list.querySelectorAll('button[data-remove-emp]').forEach(btn => {
    btn.addEventListener('click', async () => {
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No tasks match this view yet.</td></tr>';
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
      <td><button class="btn-text-small" data-history="${t.id}" data-title="${escapeHtml(t.title)}">View</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openHistoryModal(btn.dataset.history, btn.dataset.title));
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
  $('add-employee-modal').classList.remove('hidden');
});
$('ae-cancel').addEventListener('click', () => $('add-employee-modal').classList.add('hidden'));

$('add-employee-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('ae-msg');
  msg.textContent = 'Creating account...';
  msg.className = 'msg';

  const full_name = $('ae-name').value.trim();
  const email = $('ae-email').value.trim();
  const password = $('ae-password').value;

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
    role: 'employee'
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

  // also fetch the employee directory, so "not related to me" has someone to pick from
  const { data: dir } = await sb
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'employee');
  employeeDirectoryCache = dir || [];

  renderMyTickets(data || []);
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
    const isMine = t.assigned_to === currentUser.id;

    const card = document.createElement('div');
    card.className = 'ticket' + (isMine ? '' : ' readonly');
    card.innerHTML = `
      <div class="stamp ${stampClass}">${stampText}</div>
      <div class="assignee">${isMine ? 'Assigned to you' : 'Assigned to ' + escapeHtml(t.employee?.full_name || 'someone else')}</div>
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
