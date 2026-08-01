const app = document.querySelector('#app');

let state = {
  screen: 'auth',
  authMode: 'signup',
  course: '',
  year: '',
  subject: '',
  selectedNoteId: '',
  user: '',
  email: '',
  library: [],
  isAdmin: false,
  menu: '',
  notes: [],
  notesLoading: false,
  notesError: '',
  adminNotes: [],
  adminDashboard: null
};

const courses = [
  { name: 'MBBS', detail: 'Bachelor of Medicine and Bachelor of Surgery', icon: '&#9877;' },
  { name: 'BDS', detail: 'Bachelor of Dental Surgery', icon: '&#129463;' }
];

const yearSymbols = {
  'Year 1': '&#9312;',
  'Year 2': '&#9313;',
  'Year 3': '&#9314;',
  'Year 4': '&#9315;'
};

const subjectSymbols = {
  Anatomy: '&#128170;',
  Physiology: '&#129504;',
  Biochemistry: '&#129514;',
  Pathology: '&#128300;',
  Pharmacology: '&#128138;',
  Microbiology: '&#129440;',
  'Forensic Medicine': '&#9878;',
  'Community Medicine': '&#127760;',
  Ophthalmology: '&#128065;',
  ENT: '&#128066;',
  'General Medicine': '&#10010;',
  'General Surgery': '&#128137;',
  Paediatrics: '&#128118;',
  'Obstetrics & Gynaecology': '&#129328;',
  'General Anatomy': '&#128170;',
  'General Physiology': '&#129504;',
  'Dental Anatomy': '&#129463;',
  'General Pathology': '&#128300;',
  'General Pharmacology': '&#128138;',
  'Dental Materials': '&#129689;',
  'Preclinical Prosthodontics': '&#129463;',
  'Oral Pathology & Microbiology': '&#129463;',
  'Oral Medicine & Radiology': '&#128248;',
  'Paediatric & Preventive Dentistry': '&#129463;',
  'Orthodontics & Dentofacial Orthopaedics': '&#8646;',
  Periodontology: '&#127807;'
};

const curriculum = {
  MBBS: {
    'Year 1': [
      ['Anatomy', 'Gross anatomy, embryology & histology', 'AN'],
      ['Physiology', 'Human body functions & systems', 'PH'],
      ['Biochemistry', 'Molecular processes in health', 'BC']
    ],
    'Year 2': [
      ['Pathology', 'Mechanisms of disease', 'PA'],
      ['Pharmacology', 'Drugs, actions & therapeutics', 'RX'],
      ['Microbiology', 'Bacteria, viruses & immunity', 'MI'],
      ['Forensic Medicine', 'Medical law & toxicology', 'FM']
    ],
    'Year 3': [
      ['Community Medicine', 'Public health & epidemiology', 'CM'],
      ['Ophthalmology', 'Eye disorders & care', 'OP'],
      ['ENT', 'Ear, nose & throat medicine', 'ENT']
    ],
    'Year 4': [
      ['General Medicine', 'Clinical medicine essentials', 'GM'],
      ['General Surgery', 'Surgical principles & practice', 'GS'],
      ['Paediatrics', 'Child health & development', 'PD'],
      ['Obstetrics & Gynaecology', "Women's health & childbirth", 'OG']
    ]
  },
  BDS: {
    'Year 1': [
      ['General Anatomy', 'Human anatomy for dentistry', 'GA'],
      ['General Physiology', 'Body functions & systems', 'GP'],
      ['Biochemistry', 'Biomolecules & metabolism', 'BC'],
      ['Dental Anatomy', 'Tooth morphology & structure', 'DA']
    ],
    'Year 2': [
      ['General Pathology', 'Disease processes & pathology', 'PA'],
      ['General Pharmacology', 'Drugs & therapeutics', 'RX'],
      ['Dental Materials', 'Properties & uses of materials', 'DM'],
      ['Preclinical Prosthodontics', 'Introduction to dentures', 'PP']
    ],
    'Year 3': [
      ['General Medicine', 'Medical conditions relevant to dentistry', 'GM'],
      ['General Surgery', 'Core surgical principles', 'GS'],
      ['Oral Pathology & Microbiology', 'Diseases of oral tissues', 'OP']
    ],
    'Year 4': [
      ['Oral Medicine & Radiology', 'Diagnosis and dental imaging', 'OM'],
      ['Paediatric & Preventive Dentistry', 'Child oral health', 'PD'],
      ['Orthodontics & Dentofacial Orthopaedics', 'Alignment and facial growth', 'OD'],
      ['Periodontology', 'Gums & supporting structures', 'PE']
    ]
  }
};

function subjectOptionsFor(course, year) {
  return (curriculum[course]?.[year] || []).map(([name]) => name);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function jsString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function money(value) {
  return `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
}

function fallbackSymbol(name) {
  return escapeHtml(String(name || '').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?');
}

function symbolFor(stage, name, iconHint = '') {
  if (stage === 'course') {
    const match = courses.find(course => course.name === name);
    return match ? match.icon : fallbackSymbol(name);
  }
  if (stage === 'year') return yearSymbols[name] || fallbackSymbol(name);
  return subjectSymbols[name] || escapeHtml(iconHint || fallbackSymbol(name));
}

function symbolMarkup(stage, name, iconHint = '') {
  return `<span class="choice-icon" aria-hidden="true">${symbolFor(stage, name, iconHint)}</span>`;
}

function setUser(user) {
  state.user = user.name;
  state.email = user.email || '';
  state.library = user.library || [];
  state.isAdmin = !!user.isAdmin;
}

async function loadNotes() {
  state.notesLoading = true;
  state.notesError = '';
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await request('/api/notes');
      state.notes = result.notes || [];
      state.notesLoading = false;
      state.notesError = '';
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  state.notes = [];
  state.notesLoading = false;
  state.notesError = lastError?.message || 'Uploaded notes could not be loaded right now.';
  return false;
}

async function refreshNotesIfNeeded(force = false) {
  if (state.notesLoading) return;
  if (!force && state.notes.length && !state.notesError) return;
  const ok = await loadNotes();
  if (!ok && force) toast(state.notesError);
  if (['select', 'preview', 'reader'].includes(state.screen)) render();
}

function nav() {
  return `<nav class="nav">
    <div class="brand" onclick="go('select')"><i class="brand-mark"></i>inkly</div>
    <div class="nav-links">
      <a onclick="home()">Home</a>
      <div class="menu">
        <button class="nav-button" onclick="toggleMenu('explore')">Explore <span>v</span></button>
        ${state.menu === 'explore' ? `<div class="dropdown explore-menu">
          <p class="menu-label">BROWSE NOTES</p>
          <button onclick="exploreCourse('MBBS')"><b>MBBS</b><small>Bachelor of Medicine and Bachelor of Surgery</small></button>
          <button onclick="exploreCourse('BDS')"><b>BDS</b><small>Bachelor of Dental Surgery</small></button>
          <hr>
          <button onclick="closeMenu();go('select')">View all courses <b>-></b></button>
        </div>` : ''}
      </div>
      <a onclick="showLibrary()">My library</a>
      ${state.isAdmin ? '<a onclick="go(\'developer\')">Developer</a>' : ''}
      <div class="menu">
        <button class="avatar" onclick="toggleMenu('profile')">${state.user ? escapeHtml(state.user.slice(0, 2).toUpperCase()) : 'JD'}</button>
        ${state.menu === 'profile' ? `<div class="dropdown profile-menu">
          <p class="profile-name">${escapeHtml(state.user || 'Student')}</p>
          <p class="profile-sub">${state.isAdmin ? 'Developer account' : 'Inkly learner'}</p>
          <hr>
          ${state.isAdmin ? '<button onclick="closeMenu();go(\'developer\')">Developer portal</button>' : ''}
          <button onclick="closeMenu();go('profile')">My profile</button>
          <button onclick="closeMenu();showLibrary()">My library <span>${state.library.length}</span></button>
          <button onclick="closeMenu();resetSelection()">Browse notes</button>
          <hr>
          <button class="danger" onclick="signOut()">Sign out</button>
        </div>` : ''}
      </div>
    </div>
  </nav>`;
}

function go(screen) {
  state.screen = screen;
  state.menu = '';
  render();
  if (screen === 'select') setTimeout(() => refreshNotesIfNeeded(), 0);
  window.scrollTo(0, 0);
}

function toggleMenu(menu) {
  state.menu = state.menu === menu ? '' : menu;
  render();
}

function closeMenu() {
  state.menu = '';
}

function home() {
  state.course = '';
  state.year = '';
  state.subject = '';
  state.selectedNoteId = '';
  go('select');
}

function exploreCourse(course) {
  state.course = course;
  state.year = '';
  state.subject = '';
  state.selectedNoteId = '';
  closeMenu();
  go('select');
}

async function signOut() {
  try {
    await request('/api/logout', { method: 'POST' });
  } catch (_) {}
  state = { screen: 'auth', authMode: 'login', course: '', year: '', subject: '', selectedNoteId: '', user: '', email: '', library: [], isAdmin: false, menu: '', notes: [], notesLoading: false, notesError: '', adminNotes: [], adminDashboard: null };
  render();
}

function auth() {
  const signup = state.authMode === 'signup';
  return `<section class="auth screen-animate">
    <div class="auth-art">
      <div class="brand"><i class="brand-mark"></i>inkly</div>
      <div class="auth-words">
        <h1>Notes that feel<br>like a <em>friend</em><br>made them.</h1>
        <p>Clear handwritten medical notes, thoughtfully organised by course, year and subject.</p>
      </div>
      <div class="scribble">study better!</div>
      <div class="paper-stack"><b>ANATOMY NOTES</b><br>Heart: 4 chambers<br><br>Right side receives<br>deoxygenated blood.<br><br>* revise daily</div>
    </div>
    <div class="auth-form">
      <form class="form-box" onsubmit="submitAuth(event)">
        <h2>${signup ? 'Start learning smarter.' : 'Welcome back.'}</h2>
        <p>${signup ? 'Create your account and find notes made for your medical course.' : 'Log in with the account you created on this browser.'}</p>
        ${signup ? '<label class="field">Full name</label><input class="input" id="name" placeholder="Your name" required>' : ''}
        <label class="field">Email address</label>
        <input class="input" id="email" type="email" placeholder="you@example.com" required>
        <label class="field">Password</label>
        <div class="password-field">
          <input class="input" id="password" type="password" minlength="8" placeholder="********" required>
          ${signup ? '<button type="button" class="password-toggle" onclick="togglePassword(\'password\',this)">Show</button>' : ''}
        </div>
        ${signup ? '<p class="password-help">Use 8+ characters with uppercase, lowercase and a number.</p>' : '<p class="forgot"><span class="link" onclick="go(\'forgot\')">Forgot password?</span></p>'}
        <button class="primary">${signup ? 'Create account ->' : 'Log in ->'}</button>
        <p class="switch">${signup ? 'Already have an account?' : 'New to Inkly?'} <span class="link" onclick="toggleAuth()">${signup ? 'Log in' : 'Create an account'}</span></p>
      </form>
    </div>
  </section>`;
}

async function submitAuth(e) {
  e.preventDefault();
  const email = document.querySelector('#email').value.trim().toLowerCase();
  const password = document.querySelector('#password').value;
  try {
    if (state.authMode === 'signup') {
      const name = document.querySelector('#name').value.trim();
      const result = await request('/api/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
      setUser(result.user);
    } else {
      const result = await request('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      setUser(result.user);
    }
    await loadNotes();
    if (state.notesError) toast(state.notesError);
    go('select');
  } catch (error) {
    toast(error.message);
  }
}

function toggleAuth() {
  state.authMode = state.authMode === 'signup' ? 'login' : 'signup';
  render();
}

function togglePassword(id, button) {
  const input = document.querySelector(`#${id}`);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.textContent = show ? 'Hide' : 'Show';
}

function forgotPassword() {
  return `<section class="auth screen-animate">
    <div class="auth-art">
      <div class="brand"><i class="brand-mark"></i>inkly</div>
      <div class="auth-words"><h1>Back to your<br><em>best</em> study self.</h1><p>Set a new password and get back to your notes.</p></div>
    </div>
    <div class="auth-form">
      <form class="form-box" onsubmit="resetPassword(event)">
        <span class="link" onclick="go('auth')"><- Back to log in</span>
        <h2 style="margin-top:25px">Reset password.</h2>
        <p>Enter the email address used for your Inkly account.</p>
        <label class="field">Email address</label>
        <input class="input" id="reset-email" type="email" placeholder="you@example.com" required>
        <label class="field">New password</label>
        <div class="password-field">
          <input class="input" id="reset-password" type="password" minlength="8" placeholder="********" required>
          <button type="button" class="password-toggle" onclick="togglePassword('reset-password',this)">Show</button>
        </div>
        <p class="password-help">Use 8+ characters with uppercase, lowercase and a number.</p>
        <button class="primary">Update password -></button>
      </form>
    </div>
  </section>`;
}

async function resetPassword(e) {
  e.preventDefault();
  try {
    const result = await request('/api/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: document.querySelector('#reset-email').value.trim(),
        password: document.querySelector('#reset-password').value
      })
    });
    setUser(result.user);
    await loadNotes();
    if (state.notesError) toast(state.notesError);
    go('select');
    setTimeout(() => toast('Password updated - you are now signed in.'), 50);
  } catch (error) {
    toast(error.message);
  }
}

function currentStage() {
  return !state.course ? 'course' : !state.year ? 'year' : 'subject';
}

function notesForPath(subject = state.subject) {
  return state.notes.filter(note => note.course === state.course && note.year === state.year && (!subject || note.subject === subject));
}

function getItems(stage) {
  if (stage === 'course') return courses;
  if (stage === 'year') {
    return [1, 2, 3, 4].map(n => ({
      name: `Year ${n}`,
      detail: ['Foundation sciences', 'Pre-clinical subjects', 'Clinical learning', 'Final clinical year'][n - 1],
      icon: `0${n}`
    }));
  }
  return (curriculum[state.course][state.year] || []).map(([name, detail, icon]) => {
    const available = notesForPath(name);
    const price = available.length ? Math.min(...available.map(note => Number(note.price || 0))) : null;
    return {
      name,
      detail: available.length ? `${available.length} uploaded note set${available.length > 1 ? 's' : ''} from ${money(price)}` : detail,
      icon,
      available: available.length
    };
  });
}

function select() {
  const stage = currentStage();
  const items = getItems(stage);
  const val = state[stage];
  const title = stage === 'course' ? 'What are you studying?' : stage === 'year' ? 'Which year are you in?' : 'Pick a subject.';
  const description = stage === 'course'
    ? 'Choose your medical course to find notes tailored to your curriculum.'
    : stage === 'year'
      ? `Great choice. Now select your year in ${escapeHtml(state.course)}.`
      : `${escapeHtml(state.course)} - ${escapeHtml(state.year)}. Select a subject to see uploaded notes, price and preview.`;
  const subjectNotes = stage === 'subject' && state.subject ? notesForPath() : [];
  const canContinue = stage === 'subject' ? !!state.selectedNoteId : !!val;

  return `<div class="shell screen-animate">${nav()}<section class="content">
    <div class="eyebrow">Find your notes</div>
    <h1 class="heading">${title}</h1>
    <p class="sub">${description}</p>
    <div class="steps"><i class="step active"></i><i class="step ${state.course ? 'active' : ''}"></i><i class="step ${state.year ? 'active' : ''}"></i></div>
    <div class="selection-layout">
      <aside class="selection-side">
        <h3>Your learning path</h3>
        <p>Find exactly what you need in three simple steps.</p>
        ${state.course ? `<p><span class="link" onclick="resetSelection()">Start a new selection</span></p>` : ''}
        <div class="tip">* <b>Made for focus</b><br>Uploaded notes appear under the exact course, year and subject you choose.</div>
      </aside>
      <div>
        <div class="grid">${items.map(x => `<button class="choice ${val === x.name ? 'selected' : ''} ${stage === 'subject' ? 'subject-card' : ''}" onclick="choose('${stage}','${jsString(x.name)}')">
          ${symbolMarkup(stage, x.name, x.icon)}
          <span><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.detail)}</small></span>
        </button>`).join('')}</div>
        ${stage === 'subject' ? noteCards(subjectNotes) : ''}
        <div class="continue"><span>${stage === 'subject' ? selectedContinueText(subjectNotes) : val ? '1 selected' : 'Select one to continue'}</span><button class="next" ${!canContinue ? 'disabled' : ''} onclick="advance('${stage}')">Continue -></button></div>
      </div>
    </div>
  </section></div>`;
}

function noteCards(notes) {
  if (!state.subject) return '';
  if (state.notesLoading) {
    return `<div class="notes-list empty-notes">
      <h3>Loading uploaded notes for ${escapeHtml(state.subject)}...</h3>
      <p>We are checking the latest uploads for this subject.</p>
    </div>`;
  }
  if (state.notesError) {
    return `<div class="notes-list empty-notes">
      <h3>We couldn't load uploaded notes just now.</h3>
      <p>${escapeHtml(state.notesError)}</p>
      <button class="next" onclick="refreshNotesIfNeeded(true)">Retry loading notes</button>
    </div>`;
  }
  if (!notes.length) {
    return `<div class="notes-list empty-notes">
      <h3>No uploaded notes for ${escapeHtml(state.subject)} yet.</h3>
      <p>Upload this subject from the Developer portal and it will appear here with its price and preview button.</p>
      ${state.isAdmin ? '<button class="next" onclick="go(\'developer\')">Upload notes</button>' : ''}
    </div>`;
  }
  return `<div class="notes-list">
    <h3>Uploaded notes for ${escapeHtml(state.subject)}</h3>
    ${notes.map(note => {
      const owned = ownsNote(note);
      return `<article class="note-card ${state.selectedNoteId === note.id ? 'active' : ''}">
        <div>
          <b>${escapeHtml(note.title)}</b>
          <span>${escapeHtml(note.fileName)} - ${escapeHtml(note.mimeType === 'application/pdf' ? 'PDF' : 'Image')}</span>
          <small>${escapeHtml(note.course)} - ${escapeHtml(note.year)} - ${escapeHtml(note.subject)}</small>
        </div>
        <div class="note-actions">
          <strong>${owned ? 'Purchased' : money(note.price)}</strong>
          <button onclick="selectNote('${note.id}')">${owned ? 'Open' : 'Preview'}</button>
        </div>
      </article>`;
    }).join('')}
  </div>`;
}

function selectedContinueText(notes) {
  if (!state.subject) return 'Select a subject';
  if (state.notesLoading) return 'Loading uploaded notes...';
  if (state.notesError) return 'Retry loading uploaded notes';
  if (!notes.length) return 'No uploaded notes for this subject';
  return state.selectedNoteId ? 'Note selected' : 'Choose a note to preview';
}

function choose(key, value) {
  state[key] = value;
  if (key === 'course') {
    state.year = '';
    state.subject = '';
    state.selectedNoteId = '';
  }
  if (key === 'year') {
    state.subject = '';
    state.selectedNoteId = '';
  }
  if (key === 'subject') {
    const notes = notesForPath(value);
    state.selectedNoteId = notes.length === 1 ? notes[0].id : '';
  }
  render();
}

function selectNote(id) {
  const note = state.notes.find(item => item.id === id);
  if (!note) return toast('This note is no longer available.');
  state.course = note.course;
  state.year = note.year;
  state.subject = note.subject;
  state.selectedNoteId = note.id;
  go(ownsNote(note) ? 'reader' : 'preview');
}

function advance(stage) {
  if (stage === 'subject') return go('preview');
  render();
}

function resetSelection() {
  state.course = '';
  state.year = '';
  state.subject = '';
  state.selectedNoteId = '';
  state.screen = 'select';
  render();
}

function selectedUploadedNote() {
  return state.notes.find(note => note.id === state.selectedNoteId)
    || notesForPath()[0]
    || state.notes.find(note => note.course === state.course && note.year === state.year && note.subject === state.subject);
}

function ownsNote(note) {
  if (!note) return false;
  if (state.isAdmin) return true;
  return state.library.some(item => item.noteId === note.id || (!item.noteId && item.course === note.course && item.year === note.year && item.subject === note.subject));
}

function preview() {
  const note = selectedUploadedNote();
  if (!note) {
    return `<div class="shell screen-animate">${nav()}<section class="content">
      <h1 class="heading">No notes uploaded here yet.</h1>
      <p class="sub">Choose another subject or upload this note set from the Developer portal.</p>
      <button class="next" style="margin-top:25px" onclick="go('select')">Back to subjects</button>
    </section></div>`;
  }
  state.selectedNoteId = note.id;
  const owned = ownsNote(note);
  setTimeout(() => renderNotePreview(note), 0);

  return `<div class="shell note-view-shell screen-animate">${nav()}<section class="content">
    <div class="eyebrow">Notes preview</div>
    <div class="filters">
      <span class="pill">${escapeHtml(note.course)}</span>
      <span class="pill">${escapeHtml(note.year)}</span>
      <span class="pill"><b>${escapeHtml(note.subject)}</b></span>
      <span class="link" onclick="go('select')">Change</span>
    </div>
    <div class="preview">
      <div class="pdf-preview">
        <div class="preview-title">Starting 5 pages preview</div>
        <div id="preview-pages" class="pdf-pages">Loading preview...</div>
      </div>
      <div class="preview-info">
        <div class="eyebrow">Uploaded handwritten notes</div>
        <h2 class="heading">${escapeHtml(note.title)}</h2>
        <div class="meta"><span>${escapeHtml(note.fileName)}</span><span>${escapeHtml(note.mimeType === 'application/pdf' ? 'PDF' : 'Image')}</span><span>${note.pageCount || 1} pages</span><span>View-only access</span></div>
        <div class="info-box"><strong>Preview access</strong><p>You can view the first five PDF pages before buying. Full notes open inside Inkly only after purchase.</p></div>
        ${owned ? `<div class="buy"><button class="primary" onclick="go('reader')">Open full notes -></button></div>` : `<div class="buy"><div class="price">${money(note.price)} <small>one-time</small></div><button class="primary" onclick="go('payment')">Unlock full notes -></button></div>`}
        <div class="protected">View securely inside Inkly. Downloads are not available in the app.</div>
      </div>
    </div>
  </section></div>`;
}

function payment() {
  const note = selectedUploadedNote();
  if (!note) return preview();
  return `<div class="shell screen-animate">${nav()}<section class="content">
    <div class="eyebrow">Secure checkout</div>
    <h1 class="heading">Almost yours.</h1>
    <p class="sub">Pay securely with Razorpay and unlock full in-app access to these notes.</p>
    <div class="payment" style="margin-top:35px">
      <div class="pay-card">
        <h3>Razorpay checkout</h3>
        <div class="info-box">
          <strong>Accepted in Razorpay</strong>
          <p>Cards, UPI, Netbanking and supported wallets open in the secure Razorpay checkout window.</p>
        </div>
        <label class="field">Billing name</label>
        <input class="input" id="billing-name" value="${escapeHtml(state.user || '')}" placeholder="Your full name">
        <label class="field">Email address</label>
        <input class="input" id="billing-email" value="${escapeHtml(state.email || '')}" placeholder="you@example.com" type="email">
        <button class="primary" onclick="startRazorpayCheckout()">Pay ${money(note.price)} with Razorpay -></button>
      </div>
      <aside class="pay-card order">
        <h3>${escapeHtml(note.title)}</h3>
        <div class="order-row"><span>${escapeHtml(note.course)} - ${escapeHtml(note.year)}</span><span>${escapeHtml(note.subject)}</span></div>
        <div class="order-row"><span>Handwritten full notes</span><span>${money(note.price)}</span></div>
        <div class="order-row"><span>Platform access</span><span>Free</span></div>
        <div class="order-total"><span>Total</span><span>${money(note.price)}</span></div>
        <p class="secure">Your notes stay in your Inkly library and can only be read inside the app.</p>
      </aside>
    </div>
  </section></div>`;
}

let razorpayCheckoutLoading;
async function ensureRazorpayCheckout() {
  if (window.Razorpay) return window.Razorpay;
  if (!razorpayCheckoutLoading) {
    razorpayCheckoutLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(window.Razorpay);
      script.onerror = () => reject(new Error('Razorpay checkout could not be loaded. Please check your internet connection.'));
      document.head.appendChild(script);
    });
  }
  return razorpayCheckoutLoading;
}

async function startRazorpayCheckout() {
  const note = selectedUploadedNote();
  if (!note) return toast('Choose a note before checkout.');
  const billingName = document.querySelector('#billing-name')?.value.trim() || state.user || 'Inkly learner';
  const billingEmail = document.querySelector('#billing-email')?.value.trim() || state.email || '';
  try {
    await ensureRazorpayCheckout();
    const config = await request('/api/payments/razorpay/config');
    if (!config.enabled) throw new Error('Razorpay is not fully configured on the server yet. Add the Razorpay Key Secret to continue.');
    const order = await request('/api/payments/razorpay/order', { method: 'POST', body: JSON.stringify({ noteId: note.id }) });
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'Inkly',
      description: note.title,
      order_id: order.razorpayOrderId,
      prefill: {
        name: billingName,
        email: billingEmail
      },
      theme: {
        color: '#263831'
      },
      modal: {
        ondismiss: () => toast('Razorpay checkout was cancelled.')
      },
      handler: async response => {
        try {
          const result = await request('/api/payments/razorpay/verify', {
            method: 'POST',
            body: JSON.stringify({
              noteId: note.id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            })
          });
          state.library = result.library;
          state.selectedNoteId = note.id;
          go('reader');
          setTimeout(() => toast('Payment verified - notes added to your library!'), 100);
        } catch (verifyError) {
          toast(verifyError.message);
        }
      }
    });
    checkout.open();
  } catch (error) {
    toast(error.message);
  }
}

function showLibrary() {
  if (!state.library.length) {
    toast('Your library is empty. Find notes to start studying.');
    go('select');
    return;
  }
  const first = state.library[0];
  const note = first.noteId ? state.notes.find(item => item.id === first.noteId) : state.notes.find(item => item.course === first.course && item.year === first.year && item.subject === first.subject);
  if (note) selectNote(note.id);
  else {
    state.course = first.course;
    state.year = first.year;
    state.subject = first.subject;
    state.selectedNoteId = '';
    go('reader');
  }
}

function toast(message) {
  const x = document.createElement('div');
  x.className = 'toast';
  x.textContent = message;
  document.body.append(x);
  setTimeout(() => x.remove(), 3500);
}

function profile() {
  const noteCount = state.library.length;
  return `<div class="shell screen-animate">${nav()}<section class="content profile-page">
    <div class="eyebrow">Account</div>
    <h1 class="heading">Your profile.</h1>
    <p class="sub">Manage your study space and purchased notes.</p>
    <div class="profile-layout">
      <div class="pay-card profile-card">
        <div class="profile-avatar">${state.user ? escapeHtml(state.user.slice(0, 2).toUpperCase()) : 'ST'}</div>
        <h2>${escapeHtml(state.user || 'Student')}</h2>
        <p>${state.isAdmin ? 'Developer account' : 'Inkly learner'}</p>
        <hr>
        <div class="profile-stat"><span>Notes in library</span><b>${noteCount}</b></div>
        <button class="next" onclick="showLibrary()">Open my library -></button>
      </div>
      <div class="pay-card account-card">
        <h3>Account settings</h3>
        <label class="field">Display name</label>
        <input class="input" id="profile-name" value="${escapeHtml(state.user || '')}" placeholder="Your name">
        <button class="primary" onclick="saveProfile()">Save changes</button>
        <div class="settings-note"><b>Secure notes access</b><br>Purchased notes can only be viewed in the Inkly reader. Downloading is not available.</div>
        <button class="text-danger" onclick="signOut()">Sign out of Inkly</button>
      </div>
    </div>
  </section></div>`;
}

async function saveProfile() {
  const name = document.querySelector('#profile-name').value.trim();
  if (!name) return toast('Enter a display name to save your profile.');
  try {
    const result = await request('/api/profile', { method: 'PATCH', body: JSON.stringify({ name }) });
    setUser(result.user);
    toast('Profile updated successfully.');
    render();
  } catch (error) {
    toast(error.message);
  }
}

function developer() {
  if (!state.isAdmin) return `<div class="shell screen-animate">${nav()}<section class="content"><h1 class="heading">Developer access required.</h1></section></div>`;
  setTimeout(loadDeveloperPortal, 0);
  setTimeout(updateUploadSubjects, 0);
  return `<div class="shell screen-animate">${nav()}<section class="content">
    <div class="eyebrow">Developer portal</div>
    <h1 class="heading">Upload a note set.</h1>
    <p class="sub">Add handwritten PDF, JPG or PNG notes for students to purchase.</p>
    <div class="developer-toolbar">
      <div class="developer-toolbar-copy">
        <b>Manage your marketplace</b>
        <span>Refresh live metrics, filter uploaded notes, and preview any subject listing from one place.</span>
      </div>
      <button class="next developer-refresh" onclick="refreshDeveloperPortal()">Refresh dashboard</button>
    </div>
    <section class="developer-dashboard">
      <div id="developer-metrics" class="developer-metrics">Loading dashboard...</div>
      <div class="developer-panels">
        <article class="pay-card developer-panel">
          <h3>Active users</h3>
          <div id="active-users" class="developer-list">Loading active users...</div>
        </article>
        <article class="pay-card developer-panel">
          <h3>Payments</h3>
          <div id="payment-history" class="developer-list">Loading payments...</div>
        </article>
      </div>
    </section>
    <form class="pay-card upload-form" onsubmit="uploadNote(event)">
      <div class="upload-grid">
        <div><label class="field">Course</label><select class="input" id="upload-course" onchange="updateUploadSubjects()"><option>MBBS</option><option>BDS</option></select></div>
        <div><label class="field">Year</label><select class="input" id="upload-year" onchange="updateUploadSubjects()"><option>Year 1</option><option>Year 2</option><option>Year 3</option><option>Year 4</option></select></div>
      </div>
      <label class="field">Subject</label>
      <select class="input" id="upload-subject" required></select>
      <label class="field">Note title</label>
      <input class="input" id="upload-title" placeholder="e.g. HIV - Complete Notes" required>
      <label class="field">Price (Rs)</label>
      <input class="input" id="upload-price" type="number" min="0" value="79" required>
      <label class="field">Notes file</label>
      <input class="input" id="upload-file" type="file" accept="application/pdf,image/jpeg,image/png" required>
      <p class="password-help">PDF, JPG or PNG - maximum 15 MB - notes remain view-only in Inkly.</p>
      <button class="primary">Upload notes -></button>
    </form>
    <section class="uploaded-section">
      <div class="uploaded-section-head">
        <div>
          <h2>Uploaded notes</h2>
          <p>Filter by course, year, or search by title and subject.</p>
        </div>
        <div class="developer-filters">
          <input class="input" id="developer-note-search" placeholder="Search notes..." oninput="renderUploadedNotesList()">
          <select class="input" id="developer-course-filter" onchange="renderUploadedNotesList()">
            <option value="">All courses</option>
            <option value="MBBS">MBBS</option>
            <option value="BDS">BDS</option>
          </select>
          <select class="input" id="developer-year-filter" onchange="renderUploadedNotesList()">
            <option value="">All years</option>
            <option value="Year 1">Year 1</option>
            <option value="Year 2">Year 2</option>
            <option value="Year 3">Year 3</option>
            <option value="Year 4">Year 4</option>
          </select>
        </div>
      </div>
      <div id="uploaded-notes" class="uploaded-notes">Loading your notes...</div>
    </section>
  </section></div>`;
}

async function loadDeveloperPortal() {
  await Promise.all([loadUploadedNotes(), loadDeveloperDashboard()]);
}

async function refreshDeveloperPortal() {
  await loadNotes();
  await loadDeveloperPortal();
  updateUploadSubjects();
  toast('Developer dashboard refreshed.');
}

function updateUploadSubjects() {
  const courseSelect = document.querySelector('#upload-course');
  const yearSelect = document.querySelector('#upload-year');
  const subjectSelect = document.querySelector('#upload-subject');
  if (!courseSelect || !yearSelect || !subjectSelect) return;
  const previous = subjectSelect.value;
  const subjects = subjectOptionsFor(courseSelect.value, yearSelect.value);
  subjectSelect.innerHTML = subjects.map(subject => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');
  if (subjects.includes(previous)) subjectSelect.value = previous;
}

async function uploadNote(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector('button.primary');
  const file = document.querySelector('#upload-file').files[0];
  if (!file) return toast('Choose a note file to upload.');
  if (file.size > 15_000_000) return toast('Choose a file smaller than 15 MB.');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Uploading...';
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    await request('/api/admin/notes', {
      method: 'POST',
      body: JSON.stringify({
        course: document.querySelector('#upload-course').value,
        year: document.querySelector('#upload-year').value,
        subject: document.querySelector('#upload-subject').value.trim(),
        title: document.querySelector('#upload-title').value.trim(),
        price: document.querySelector('#upload-price').value,
        fileName: file.name,
        mimeType: file.type,
        fileData: base64
      })
    });
    toast('Notes uploaded successfully.');
    event.target.reset();
    updateUploadSubjects();
    await loadNotes();
    await loadDeveloperPortal();
  } catch (error) {
    toast(error.message);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Upload notes ->';
    }
  }
}

async function loadUploadedNotes() {
  try {
    const { notes } = await request('/api/admin/notes');
    state.notes = notes || state.notes;
    state.adminNotes = notes || [];
    renderUploadedNotesList();
  } catch (error) {
    const el = document.querySelector('#uploaded-notes');
    if (el) el.textContent = error.message;
  }
}

async function loadDeveloperDashboard() {
  try {
    const { metrics, activeUsers, payments } = await request('/api/admin/dashboard');
    state.adminDashboard = { metrics, activeUsers, payments };
    const metricsEl = document.querySelector('#developer-metrics');
    if (metricsEl) {
      metricsEl.innerHTML = [
        dashboardMetric('Active users', metrics.activeUsers),
        dashboardMetric('Active sessions', metrics.activeSessions),
        dashboardMetric('Payments', metrics.totalPayments),
        dashboardMetric('Revenue', money(metrics.revenue)),
        dashboardMetric('Students', metrics.totalUsers),
        dashboardMetric('Uploaded notes', metrics.totalNotes)
      ].join('');
    }
    const usersEl = document.querySelector('#active-users');
    if (usersEl) {
      usersEl.innerHTML = activeUsers.length
        ? activeUsers.map(item => `<div class="developer-row">
            <div>
              <b>${escapeHtml(item.name)}</b>
              <span>${escapeHtml(item.email)}</span>
              <small class="developer-chip">${item.libraryCount} note${item.libraryCount === 1 ? '' : 's'} in library</small>
            </div>
            <strong class="developer-mini-stat">Active</strong>
          </div>`).join('')
        : '<p class="developer-empty">No active users right now.</p>';
    }
    const paymentsEl = document.querySelector('#payment-history');
    if (paymentsEl) {
      paymentsEl.innerHTML = payments.length
        ? payments.map(payment => `<div class="developer-row">
            <div>
              <b>${escapeHtml(payment.noteTitle)}</b>
              <span>${escapeHtml(payment.buyerName)} - ${escapeHtml(payment.buyerEmail)}</span>
              <small>${escapeHtml(payment.course)} - ${escapeHtml(payment.year)} - ${escapeHtml(payment.subject)}</small>
            </div>
            <div class="developer-payment-side">
              <strong>${money(payment.amount)}</strong>
              <small class="developer-chip">${escapeHtml(payment.provider)}</small>
            </div>
          </div>`).join('')
        : '<p class="developer-empty">No payments recorded yet.</p>';
    }
  } catch (error) {
    const metricsEl = document.querySelector('#developer-metrics');
    const usersEl = document.querySelector('#active-users');
    const paymentsEl = document.querySelector('#payment-history');
    if (metricsEl) metricsEl.textContent = error.message;
    if (usersEl) usersEl.textContent = error.message;
    if (paymentsEl) paymentsEl.textContent = error.message;
  }
}

function dashboardMetric(label, value) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></article>`;
}

function renderUploadedNotesList() {
  const el = document.querySelector('#uploaded-notes');
  if (!el) return;
  const search = (document.querySelector('#developer-note-search')?.value || '').trim().toLowerCase();
  const course = document.querySelector('#developer-course-filter')?.value || '';
  const year = document.querySelector('#developer-year-filter')?.value || '';
  const notes = (state.adminNotes || []).filter(note => {
    const matchesSearch = !search || [note.title, note.subject, note.fileName].some(value => String(value || '').toLowerCase().includes(search));
    const matchesCourse = !course || note.course === course;
    const matchesYear = !year || note.year === year;
    return matchesSearch && matchesCourse && matchesYear;
  });
  el.innerHTML = notes.length
    ? notes.map(note => `<article class="uploaded-note uploaded-note-rich">
        <div class="uploaded-note-main">
          <div class="uploaded-note-title">
            <b>${escapeHtml(note.title)}</b>
            <span class="developer-chip">${money(note.price)}</span>
          </div>
          <span>${escapeHtml(note.course)} - ${escapeHtml(note.year)} - ${escapeHtml(note.subject)}</span>
          <small>${escapeHtml(note.fileName)} - ${note.pageCount || 1} page${Number(note.pageCount || 1) === 1 ? '' : 's'}</small>
        </div>
        <div class="uploaded-note-actions">
          <small>${formatShortDate(note.uploadedAt)}</small>
          <button onclick="selectNote('${note.id}')">Preview</button>
        </div>
      </article>`).join('')
    : '<p class="developer-empty">No uploaded notes match these filters yet.</p>';
}

function formatShortDate(value) {
  if (!value) return 'Recently added';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently added';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function reader() {
  const note = selectedUploadedNote();
  if (!note) {
    return `<section class="reader screen-animate"><header class="reader-nav"><div class="brand"><i class="brand-mark"></i>inkly</div><div class="reader-tools"><button onclick="go('select')"><- Back</button></div></header><div class="reader-body"><article class="reader-page"><h1>No note selected</h1><p>Please choose an uploaded note from the subjects page.</p></article></div></section>`;
  }
  if (!ownsNote(note)) return preview();
  setTimeout(() => renderSecureNote(note), 0);
  return `<section class="reader screen-animate">
    <header class="reader-nav">
      <div class="brand"><i class="brand-mark"></i>inkly</div>
      <div class="reader-tools">
        <span>${escapeHtml(note.title)} - ${escapeHtml(note.course)}</span>
        <button onclick="go('preview')"><- Back to details</button>
        <button disabled title="Notes are securely view-only">Download disabled</button>
      </div>
    </header>
    <div class="reader-body secure-reader"><div id="reader-pages" class="pdf-pages reader-pages">Loading full notes...</div></div>
  </section>`;
}

function fileUrl(noteId, previewOnly = false) {
  return `/api/notes/${encodeURIComponent(noteId)}/file${previewOnly ? '?preview=1' : ''}`;
}

function pageImageUrl(noteId, pageNumber, previewOnly = false) {
  return `/api/notes/${encodeURIComponent(noteId)}/pages/${pageNumber}${previewOnly ? '?preview=1' : ''}`;
}

async function renderNotePreview(note) {
  const container = document.querySelector('#preview-pages');
  if (!container) return;
  await renderFile(container, note, 5);
}

async function renderSecureNote(note) {
  const container = document.querySelector('#reader-pages');
  if (!container) return;
  await renderFile(container, note, Infinity);
}

async function renderFile(container, note, maxPages) {
  container.innerHTML = '<div class="loading-note">Loading pages...</div>';
  if (note.mimeType !== 'application/pdf') {
    container.innerHTML = `<img class="secure-image is-loaded" src="${fileUrl(note.id, maxPages !== Infinity)}" alt="${escapeHtml(note.title)}">`;
    return;
  }
  const totalPages = Math.max(1, Number(note.pageCount || 1));
  const count = Math.min(totalPages, maxPages);
  const previewOnly = maxPages !== Infinity;
  const batchSize = previewOnly ? count : 4;
  container.innerHTML = '';
  let rendered = 0;
  let loaded = 0;

  const progress = document.createElement('div');
  progress.className = 'loading-note loading-progress';
  progress.textContent = `Loading pages 0 of ${count}...`;
  container.append(progress);

  const updateProgress = () => {
    progress.textContent = loaded >= count
      ? `Loaded ${count} page${count === 1 ? '' : 's'}`
      : `Loading pages ${loaded} of ${count}...`;
    if (loaded > 0) progress.classList.add('is-soft');
    if (loaded >= Math.min(2, count)) {
      progress.classList.add('is-complete');
      setTimeout(() => progress.remove(), 350);
    }
  };

  const appendPlaceholder = pageNumber => {
    const placeholder = document.createElement('div');
    placeholder.className = 'page-placeholder';
    placeholder.dataset.page = String(pageNumber);
    placeholder.innerHTML = `<span>Page ${pageNumber}</span>`;
    container.append(placeholder);
  };

  const appendPage = pageNumber => {
    appendPlaceholder(pageNumber);
    const img = document.createElement('img');
    img.className = 'pdf-page-image';
    img.loading = pageNumber === 1 ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (pageNumber === 1) img.fetchPriority = 'high';
    let attempts = 0;
    const maxAttempts = 3;
    const setImageSource = () => {
      const separator = previewOnly ? '&' : '?';
      img.src = `${pageImageUrl(note.id, pageNumber, previewOnly)}${separator}attempt=${attempts}&t=${Date.now()}`;
    };
    img.alt = `${note.title} page ${pageNumber}`;
    img.addEventListener('load', () => {
      loaded += 1;
      container.querySelector(`.page-placeholder[data-page="${pageNumber}"]`)?.remove();
      img.classList.add('is-loaded');
      updateProgress();
    }, { once: true });
    img.addEventListener('error', () => {
      if (attempts < maxAttempts - 1) {
        attempts += 1;
        setTimeout(setImageSource, 600 * attempts);
        return;
      }
      loaded += 1;
      container.querySelector(`.page-placeholder[data-page="${pageNumber}"]`)?.remove();
      img.classList.add('is-loaded');
      img.alt = `${note.title} page ${pageNumber} failed to load`;
      updateProgress();
    });
    setImageSource();
    container.append(img);
  };

  const renderNextBatch = () => {
    const nextEnd = Math.min(count, rendered + batchSize);
    for (let pageNumber = rendered + 1; pageNumber <= nextEnd; pageNumber += 1) appendPage(pageNumber);
    rendered = nextEnd;
  };

  renderNextBatch();
  updateProgress();

  if (!previewOnly && rendered < count) {
    const sentinel = document.createElement('div');
    sentinel.className = 'page-sentinel';
    container.append(sentinel);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      renderNextBatch();
      if (rendered >= count) {
        observer.disconnect();
        sentinel.remove();
      }
    }, { root: container, rootMargin: '240px 0px' });
    observer.observe(sentinel);
  }

  if (previewOnly && totalPages > count) {
    const locked = document.createElement('div');
    locked.className = 'locked-pages';
    locked.textContent = `${totalPages - count} more page${totalPages - count === 1 ? '' : 's'} available after purchase`;
    container.append(locked);
  }
}

function render() {
  app.innerHTML = state.screen === 'auth'
    ? auth()
    : state.screen === 'forgot'
      ? forgotPassword()
      : state.screen === 'select'
        ? select()
        : state.screen === 'preview'
          ? preview()
          : state.screen === 'payment'
            ? payment()
            : state.screen === 'profile'
              ? profile()
              : state.screen === 'developer'
                ? developer()
                : reader();
}

async function start() {
  try {
    const result = await request('/api/me');
    if (result.user) {
      setUser(result.user);
      await loadNotes();
      if (state.notesError) toast(state.notesError);
      state.screen = 'select';
    }
  } catch (_) {
    toast('Start Inkly with npm start, then open http://localhost:3000.');
  }
  render();
}

start();
