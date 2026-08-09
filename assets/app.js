import { findRegion } from "./regions.js";

// 어디가지 — 조건으로 찾는 장소
// 위치·이동수단·반경·실시간 검색 전부 동작한다.
// (2026-08-08 정정: 여기와 화면 하단에 "실시간 검색은 키 붙이면 열림"이라고 적혀 있었는데
//  키는 8/3에 붙었고 그때부터 동작 중이었다. 앱이 자기 기능을 못 쓴다고 광고하고 있었다.)

const MODES = {
  walk: { label: '걸어서', kmh: 4.5, fixed: 0, max: 30, step: 5, def: 15 },
  car:  { label: '차로',   kmh: 38,  fixed: 2, max: 60, step: 5, def: 20 },
};
const ROAD_FACTOR = 1.35; // 직선거리 → 실제 도로 보정

const state = {
  mode: 'car',
  minutes: MODES.car.def,
  origin: null,      // {lat,lng,label}
  places: [],
};

const $ = (s) => document.querySelector(s);

/* ── 얼마나 쓰는가 ──
   이 앱의 판정 기준은 매출이 아니라 "몇 번 여는가"인데, 8/3 배포 후 5일 동안 그걸 셀 장치가
   없어서 사용 여부를 사람 기억에 물어봐야 했다(답: 0회, 아예 안 열었음).
   그래서 브라우저 안에 직접 센다. 서버로 아무것도 보내지 않는다 — 지인 공유 단계가 되면
   그때 서버 집계를 따로 설계한다. */
const USE_KEY = 'odiga.use.v1';

// 홈화면에서 연 건지 브라우저로 연 건지 나눠 센다.
// "설치가 실제로 사용을 만들었나"가 이번 변경의 판정 질문이라, 이걸 안 나누면 답이 안 나온다.
const fromHome = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true ||
  new URLSearchParams(location.search).get('src') === 'home';

const loadUses = () => { try { return JSON.parse(localStorage.getItem(USE_KEY)) || []; } catch { return []; } };

function logUse(kind) {
  const l = loadUses();
  l.push({ t: new Date().toISOString(), k: kind, h: fromHome() });
  // 무한히 쌓으면 저장 한도에 걸린다. 판정에 필요한 건 최근 몇 달치다.
  try { localStorage.setItem(USE_KEY, JSON.stringify(l.slice(-400))); } catch {}
  showUses();
}

function showUses() {
  const el = $('#useCount');
  if (!el) return;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const m = loadUses().filter((u) => (u.t || '').startsWith(ym));
  const opens = m.filter((u) => u.k === 'open').length;
  const finds = m.filter((u) => u.k === 'search').length;
  const home  = m.filter((u) => u.h).length;
  el.textContent = opens || finds
    ? `이번 달 ${opens}번 열고 ${finds}번 찾았어${home ? ` · 홈화면에서 ${home}번` : ''}`
    : '';
}

/* ── 홈화면에 깔기 ──
   5일간 0회의 원인은 기능이 아니라 진입점이었다. 주소를 기억해서 브라우저에 치는 일이
   일어나지 않았다. 아이콘이 홈화면에 있으면 그 단계가 사라진다. */
const SNOOZE_KEY = 'odiga.install.snooze';
let installPrompt = null;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);   // iPadOS는 맥으로 위장한다

function snooze(days) {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 864e5)); } catch {}
  $('#install').hidden = true;
}

function showInstall() {
  const el = $('#install');
  if (!el) return;
  // 이미 깔았으면 볼 이유가 없다.
  if (fromHome()) { el.hidden = true; return; }
  if (Date.now() < (+localStorage.getItem(SNOOZE_KEY) || 0)) { el.hidden = true; return; }

  // 크롬 계열은 브라우저가 직접 설치창을 띄워준다. 그 외(사파리)는 손으로 하는 수밖에 없다.
  const how = installPrompt
    ? '<p>아래 버튼 한 번이면 홈화면에 아이콘이 생겨.</p>'
    : isIOS
      ? '<p>사파리 아래쪽 <kbd>공유</kbd> → <kbd>홈 화면에 추가</kbd> 를 누르면 아이콘이 생겨.</p>'
      : '<p>브라우저 메뉴(⋮) → <kbd>홈 화면에 추가</kbd> 또는 <kbd>앱 설치</kbd> 를 누르면 아이콘이 생겨.</p>';

  el.innerHTML = `<b>홈화면에 깔아두자</b>
    <p>주소를 기억해서 치는 동안엔 안 열게 돼. 아이콘이 있으면 한 번에 열려.</p>
    ${how}
    <div class="row">
      ${installPrompt ? '<button type="button" class="p" id="insBtn">홈화면에 추가</button>' : ''}
      <button type="button" id="insLater">나중에</button>
    </div>`;
  el.hidden = false;

  $('#insLater').addEventListener('click', () => snooze(7));   // 영구히 지우지 않는다. 일주일 뒤 다시 묻는다
  $('#insBtn')?.addEventListener('click', async () => {
    const p = installPrompt;
    installPrompt = null;
    el.hidden = true;
    p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome !== 'accepted') snooze(3);
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // 브라우저 기본 배너를 막고 우리 배너에서 띄운다
  installPrompt = e;
  showInstall();
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; logUse('install'); });

/* ── 거리 ── */
function haversine(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function travel(km, mode) {
  const m = MODES[mode];
  const road = km * ROAD_FACTOR;
  return { road, min: Math.round((road / m.kmh) * 60 + m.fixed) };
}

/* ── 위치 ── */
// 어디로 인식됐는지 화면에 보여준다. 안 보여주면 결과가 이상할 때
// 위치 탓인지 검색 탓인지 사용자가 구분할 수 없다.
async function setOrigin(lat, lng) {
  state.origin = { lat, lng };
  const el = $('#locText');
  el.innerHTML = '여기가 어딘지 확인 중…';
  try {
    const r = await fetch(`/api/where?lat=${lat}&lng=${lng}`);
    const d = await r.json();
    state.region = d.region || null;
    el.innerHTML = d.region
      ? `지금 <b>${d.region}</b>${d.near && d.near !== d.region ? ` · ${d.near}` : ''} 근처`
      : `위치는 잡았는데 동네 이름을 못 알아냈어 — 조건에 지역을 써줘`;
  } catch {
    state.region = null;
    el.innerHTML = '위치는 잡았어 (동네 확인 실패)';
  }
  render();
}
function locate() {
  const el = $('#locText');
  if (!navigator.geolocation) {
    el.textContent = '이 브라우저는 위치를 못 써 — 조건에 지역을 같이 써줘';
    return;
  }
  el.textContent = '위치 잡는 중…';
  navigator.geolocation.getCurrentPosition(
    (p) => setOrigin(p.coords.latitude, p.coords.longitude),
    (err) => {
      state.origin = null; state.region = null;
      const why = { 1: '위치 권한이 꺼져 있어', 2: '위치를 못 잡았어', 3: '시간이 초과됐어' }[err.code]
        || '위치를 못 잡았어';
      el.innerHTML = `${why} — 조건 앞에 지역을 써줘 (예: <b>용인</b> 한정식)`;
    },
    // 캐시된 옛날 좌표를 쓰면 다른 동네에서 이전 위치가 그대로 나온다.
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/* ── 렌더 ── */
function card(p, dist, best) {
  const el = document.createElement('article');
  el.className = 'card' + (best ? ' best' : '');
  const price = p.priceLow
    ? (p.priceLow === p.priceHigh
        ? p.priceLow.toLocaleString() + '원'
        : `${p.priceLow.toLocaleString()}~${p.priceHigh.toLocaleString()}`)
    : '<span style="color:var(--muted);font-weight:600;font-size:13px">' + (p.priceNote || '미확인') + '</span>';

  const far = dist.min > state.minutes;
  const parts = [`
    <div class="cbody">
      <div class="crow">
        <h3 class="cname">${p.name}<small>${p.kind}</small></h3>
        <div class="cprice">${price}</div>
        <div class="cmeta">${p.addr}${p.parking ? ' · ' + p.parking : ''}</div>
        <div class="ctime${far ? ' far' : ''}">${dist.min
          ? `${MODES[state.mode].label} ${dist.min}분 · ${dist.road.toFixed(1)}km`
          : '거리 미계산'}</div>
      </div>`];

  if (p.hours || p.closed) {
    parts.push(`<div class="cmeta">🕘 ${[p.hours, p.closed].filter(Boolean).join(' · ')}</div>`);
  }
  // "여기가 좋은 집인가"와 "내 조건에 맞는가"는 다른 질문이다. 나눠서 보여준다.
  const evRow = (e, cls) => `<div class="e${cls}"><span class="ek">${e.k}${
      e.ad ? `<span class="adflag">${e.ad}</span>` : ''}</span><q>${e.q}</q>
      <a href="${e.url}" target="_blank" rel="noopener">${e.date}</a></div>`;
  if (p.good?.length) {
    parts.push('<div class="ev good"><span class="evhd">여기가 좋다는 근거</span>'
      + p.good.map((e) => evRow(e, ' g')).join('') + '</div>');
  } else {
    parts.push('<div class="ev"><span class="evhd none">여기가 좋다는 근거는 못 찾았어 — '
      + '조건만 맞는 곳이야</span></div>');
  }
  if (p.evidence?.length) {
    parts.push('<div class="ev"><span class="evhd">내 조건</span>'
      + p.evidence.map((e) => evRow(e, '')).join('') + '</div>');
  }
  if (p.warn?.length) {
    parts.push(`<div class="warn"><b>⚠︎ 주의</b>${p.warn.map((w) => `<span>${w}</span>`).join('')}</div>`);
  }
  const mapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  parts.push(`<div class="acts">
      <a class="p" href="${p.tel ? 'tel:' + p.tel.replace(/-/g, '') : '#'}" ${p.tel ? '' : 'aria-disabled="true"'}>${p.tel ? '전화' : '번호 없음'}</a>
      <a href="${mapUrl}" target="_blank" rel="noopener">길찾기</a>
    </div></div>`);

  if (p.photos?.length) {
    parts.push('<div class="shots">' +
      p.photos.map((s) => `<img src="${s}" alt="${p.name} 사진" loading="lazy">`).join('') + '</div>');
  }
  el.innerHTML = parts.join('');
  return el;
}

function render() {
  const box = $('#results');
  box.innerHTML = '';
  if (!state.places.length) {
    box.innerHTML = '<p class="empty">조건을 넣고 찾아줘를 눌러봐</p>';
    return;
  }
  // 위치를 못 잡았어도 결과는 보여준다. 거리만 빠진다.
  if (!state.origin) {
    const head = document.createElement('div');
    head.className = 'rhead';
    head.innerHTML = `<span>${state.places.length}곳 · 거리 미계산</span><span>위치 허용하면 순서가 바뀜</span>`;
    box.appendChild(head);
    state.places.forEach((p, i) => box.appendChild(card(p, { road: 0, min: 0 }, i === 0)));
    return;
  }
  const scored = state.places
    .map((p) => ({ p, d: travel(haversine(state.origin, p), state.mode) }))
    .sort((a, b) => a.d.min - b.d.min);

  const inRange = scored.filter((s) => s.d.min <= state.minutes);
  const out = inRange.length ? inRange : scored.slice(0, 3);

  const head = document.createElement('div');
  head.className = 'rhead';
  head.innerHTML = inRange.length
    ? `<span>${MODES[state.mode].label} ${state.minutes}분 안 · ${inRange.length}곳</span><span>근거 많은 순</span>`
    : `<span style="color:var(--caution)">${state.minutes}분 안엔 없어 — 가까운 순 3곳</span><span>반경을 넓혀봐</span>`;
  box.appendChild(head);
  out.forEach((s, i) => box.appendChild(card(s.p, s.d, i === 0 && inRange.length > 0)));
}

/* ── 조건 검색 ── */
// 네이버 지역 검색은 좌표만으로 범위를 좁힐 수 없다. 지역명이 있어야 결과가 그 동네로 모인다.
// (2026-08-03 실측: 지역명 없이 "카페 노트북 콘센트"로 찾으면 30건 중 해당 지역이 2건뿐이었다.)
// 지역은 추측하지 않고 사전에 있을 때만 인정한다 (assets/regions.js 주석 참고).
const pickRegion = (q) => findRegion(q);

function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

async function search() {
  const q = $('#q').value.trim();
  const n = $('#notice');
  const btn = $('#goBtn');
  if (!q) { $('#q').focus(); return; }

  // 지역명을 안 썼어도 위치가 있으면 서버가 좌표로 알아낸다.
  const region = pickRegion(q);
  if (!region && !state.origin) {
    n.hidden = false;
    n.innerHTML = `<b>여기가 어딘지 몰라.</b>
      <span>위 <b>다시 잡기</b>로 위치를 허용하거나, 조건 앞에 지역을 써줘 — 예: <b>용인</b> 한정식.</span>`;
    return;
  }

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = '블로그 읽는 중…';
  n.hidden = false;
  n.innerHTML = `<b>${region ? esc(region) + ' 근처에서' : '지금 있는 곳 근처에서'} 찾는 중</b>
    <span>후보를 잡고 블로그 본문을 열어 조건별 근거를 뽑고 있어. 10초쯤 걸려.</span>`;

  try {
    const p = new URLSearchParams({ q });
    if (region) p.set('region', region);
    if (state.origin) { p.set('lat', state.origin.lat); p.set('lng', state.origin.lng); }
    const r = await fetch(`/api/search?${p}`);
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);

    if (!d.places?.length) {
      n.innerHTML = `<b>"${esc(region)}"에서 못 찾았어.</b>
        <span>지역명을 더 넓게(예: 면·읍 대신 시·군) 써보거나, 음식 종류를 같이 적어줘.</span>`;
      return;
    }

    // 서버가 준 좌표에 내 위치 기준 거리를 입힌다.
    state.places = d.places.map((x) => ({
      id: x.name, name: x.name, kind: x.kind, addr: x.addr, lat: x.lat, lng: x.lng,
      tel: x.tel || null,
      priceLow: x.priceLow, priceHigh: x.priceHigh,
      priceNote: x.priceLow ? null : '가격 미확인',
      evidence: x.evidence.map((e) => ({ k: e.k, q: e.q, url: e.url, date: e.date, ad: e.ad })),
      good: (x.good || []).map((e) => ({ k: e.k, q: e.q, url: e.url, date: e.date, ad: e.ad })),
      warn: [
        ...x.warn.map((w) => `${w.q} (${w.date})`),
        ...(x.missing.length ? [`미확인: ${x.missing.join(', ')}`] : []),
      ],
      photos: [],
    }));

    n.innerHTML = `<b>${esc(d.region)} · ${d.places.length}곳</b>
      <span>조건 <b>${d.asked.join(' · ') || '없음'}</b> 기준.
      ${d.regionFrom === '현재 위치' ? '지역은 <b>현재 위치</b>에서 잡았어. ' : ''}
      인용은 실제 블로그 본문에서 뽑았고 날짜·링크가 붙어 있어.</span>`;
    render();
    logUse('search');   // 결과가 실제로 나온 것만 센다. 오타·실패는 사용이 아니다
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    n.innerHTML = `<b>검색이 실패했어.</b><span>${esc(e.message)} — 잠시 뒤 다시 눌러줘.</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ── 초기화 ── */
function bindMode() {
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll('#modeSeg button').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b)));
      const m = MODES[state.mode];
      const r = $('#rad');
      r.max = m.max; r.step = m.step;
      state.minutes = Math.min(state.minutes, m.max);
      r.value = state.minutes;
      $('#radOut').textContent = `${m.label} ${state.minutes}분`;
      render();
    });
  });
  $('#rad').addEventListener('input', (e) => {
    state.minutes = +e.target.value;
    $('#radOut').textContent = `${MODES[state.mode].label} ${state.minutes}분`;
    render();
  });
}

async function init() {
  bindMode();
  $('#locBtn').addEventListener('click', locate);
  $('#goBtn').addEventListener('click', search);
  document.querySelectorAll('#pickFallback button').forEach((b) =>
    b.addEventListener('click', () =>
      setOrigin(+b.dataset.lat, +b.dataset.lng, b.textContent)));
  $('#radOut').textContent = `${MODES.car.label} ${state.minutes}분`;

  logUse('open');
  showInstall();   // beforeinstallprompt 가 안 오는 브라우저(사파리)에서도 안내는 떠야 한다

  // 미리 저장해둔 목록을 먼저 띄우지 않는다.
  // 8/3 가평 데이터를 초기 화면에 뿌렸더니 다른 동네에서 열어도 가평이 나와,
  // 검색이 된 건지 안 된 건지 구분할 수 없었다.
  render();
  locate();
}
document.addEventListener('DOMContentLoaded', init);
