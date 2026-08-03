// 어디가지 — 조건으로 찾는 장소
// v0: 위치·이동수단·반경은 실제 동작. 실시간 검색은 백엔드(네이버 검색 키) 연결 후.

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
function setOrigin(lat, lng, label) {
  state.origin = { lat, lng, label };
  $('#locText').innerHTML = `기준 <b>${label}</b>`;
  render();
}
function locate() {
  const el = $('#locText');
  if (!navigator.geolocation) {
    el.textContent = '이 브라우저는 위치를 지원하지 않아';
    return;
  }
  el.textContent = '위치 잡는 중…';
  navigator.geolocation.getCurrentPosition(
    (p) => setOrigin(p.coords.latitude, p.coords.longitude, '현재 위치'),
    (err) => {
      const why = { 1: '위치 권한이 꺼져 있어', 2: '위치를 못 잡았어', 3: '시간이 초과됐어' }[err.code]
        || '위치를 못 잡았어';
      el.innerHTML = `${why} — 아래에서 직접 골라줘`;
      $('#pickFallback').hidden = false;
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
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
        <div class="ctime${far ? ' far' : ''}">${MODES[state.mode].label} ${dist.min}분 · ${dist.road.toFixed(1)}km</div>
      </div>`];

  if (p.hours || p.closed) {
    parts.push(`<div class="cmeta">🕘 ${[p.hours, p.closed].filter(Boolean).join(' · ')}</div>`);
  }
  if (p.evidence?.length) {
    parts.push('<div class="ev">' + p.evidence.map((e) => `
      <div class="e"><span class="ek">${e.k}</span><q>${e.q}</q>
      <a href="${e.url}" target="_blank" rel="noopener">${e.date}</a></div>`).join('') + '</div>');
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
  if (!state.origin) {
    box.innerHTML = '<p class="empty">위치를 먼저 잡아줘 ↑</p>';
    return;
  }
  const scored = state.places
    .map((p) => ({ p, d: travel(haversine(state.origin, p), state.mode) }))
    .filter(({ p }) => p.id !== 'riverain' || haversine(state.origin, p) > 0.15)
    .sort((a, b) => a.d.min - b.d.min);

  const inRange = scored.filter((s) => s.d.min <= state.minutes);
  const out = inRange.length ? inRange : scored.slice(0, 3);

  const head = document.createElement('div');
  head.className = 'rhead';
  head.innerHTML = inRange.length
    ? `<span>${MODES[state.mode].label} ${state.minutes}분 안 · ${inRange.length}곳</span><span>수집 8/3</span>`
    : `<span style="color:var(--caution)">${state.minutes}분 안엔 없어 — 가까운 순 3곳</span><span>수집 8/3</span>`;
  box.appendChild(head);
  out.forEach((s, i) => box.appendChild(card(s.p, s.d, i === 0 && inRange.length > 0)));
}

/* ── 조건 검색 (백엔드 대기) ── */
function search() {
  const q = $('#q').value.trim();
  const n = $('#notice');
  if (!q) { $('#q').focus(); return; }
  n.hidden = false;
  n.innerHTML = `<b>아직 실시간 검색은 안 붙었어.</b>
    <span>"${q.replace(/</g, '&lt;')}" — 이 조건으로 블로그를 새로 읽으려면 네이버 검색 키가 필요해.
    지금 아래 목록은 <b>8월 3일에 미리 읽어둔 6곳</b>이고, 거리·이동수단은 진짜로 계산된 거야.</span>`;
  n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  try {
    const r = await fetch('data/places.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.places = (await r.json()).places;
  } catch (e) {
    $('#results').innerHTML =
      `<p class="empty">장소 데이터를 못 불러왔어 (${e.message})<br>새로고침해봐</p>`;
    return;
  }
  locate();
}
document.addEventListener('DOMContentLoaded', init);
