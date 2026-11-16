/**
 * @file components/character-data.js
 * @description 산리오(40종) 및 캐치! 티니핑(179종) 멀티 도메인 캐릭터 메타데이터 로드,
 * 시즌별 필터링, 이름/프로필 포맷팅 및 이미지 프리로딩을 담당하는 데이터 모듈.
 */

export const DOMAINS = ['sanrio', 'teenieping'];

export const DOMAIN_META = Object.freeze({
  sanrio: {
    id: 'sanrio',
    badge: '산리오',
    title: '산리오 40종',
    pokedexTitle: '산리오 40종 도감 & 학습 현황',
    supportsEnName: true
  },
  teenieping: {
    id: 'teenieping',
    badge: '티니핑',
    title: '캐치! 티니핑',
    pokedexTitle: '티니핑 도감 & 학습 현황',
    supportsEnName: false
  }
});

export const TEENIEPING_SEASONS = [
  { id: 'all', label: '전체 시즌 (179종)', shortLabel: '전체' },
  { id: '1기', label: '1기 · 큐브 (44종)', shortLabel: '1기' },
  { id: '2기', label: '2기 · 보석 (20종)', shortLabel: '2기' },
  { id: '3기', label: '3기 · 열쇠 (21종)', shortLabel: '3기' },
  { id: '4기', label: '4기 · 디저트 (21종)', shortLabel: '4기' },
  { id: '5기', label: '5기 · 스타 (25종)', shortLabel: '5기' },
  { id: '6기', label: '6기 · 프린세스 (24종)', shortLabel: '6기' },
  { id: '7기', label: '7기 · 스테이지 (19종)', shortLabel: '7기' },
  { id: '극장판', label: '극장판 (5종)', shortLabel: '극장판' }
];

const DEFAULT_SANRIO_RAW = [
  [1, 1, "Bad Badtz-Maru", "배드바츠마루", "4월 1일", "오아후 섬(하와이) 고저스 타운", "XO형(설정상 불명/특수)", "1993"],
  [1, 2, "Charmmy Kitty", "차미키티", "10월 31일", "런던 교외(키티가 선물받은 날)", "불명", "2004"],
  [1, 3, "Chibimaru", "치비마루", "2월 2일", "하얀 집(일본)", "불명", "2003"],
  [1, 4, "Chi Chai Monchan", "치차이몬찬", "1월 15일", "남쪽 바다의 작은 열대 섬", "불명", "2003"],
  [1, 5, "Chococat", "초코캣", "5월 10일", "초코초코 하우스", "불명", "1996"],
  [1, 6, "Cinnamoroll", "시나모롤", "3월 6일", "먼 하늘 구름 위", "불명", "2001"],
  [1, 7, "Deery-Lou", "디어리루", "1월 8일", "무지개 숲(Rainbow Forest)", "불명", "2002"],
  [1, 8, "Pinki Lili", "핑키릴리", "3월 22일", "벚꽃 피는 숲속", "불명", "2002"],
  [2, 1, "Dokidoki Yummychums", "도키도키야미첨스", "불명", "패스트푸드 레스토랑", "불명", "2003"],
  [2, 2, "Hello Kitty", "헬로키티", "11월 1일", "영국 런던 교외", "A형", "1974"],
  [2, 3, "Kerokerokeroppi", "케로케로케로피", "7월 10일", "도넛 연못", "O형", "1988"],
  [2, 4, "Corocorokuririn", "코로코로쿠리링", "2월 4일", "주인집(입양된 날)", "불명", "1997"],
  [2, 5, "Kuromi", "쿠로미", "10월 31일", "마리랜드", "불명", "2005"],
  [2, 6, "Taraiguma no Landry", "아라이구마 랜드리", "12월 8일", "세탁 통(일본)", "불명", "1999"],
  [2, 7, "Little Twin Stars", "리틀트윈스타", "12월 24일", "꿈별 구름의 배려하기 별", "불명", "1975"],
  [2, 8, "Pannapitta", "판나피타", "10월 7일", "판나랜드(Pannaland)", "불명", "2003"],
  [3, 1, "Minna no Tabo", "민나노타보", "5월 5일", "일본", "A형", "1984"],
  [3, 2, "Osaru no Monkichi", "오사루노몽키치(몽키치)", "1월 13일", "일본 시골 산속", "불명", "1992"],
  [3, 3, "My Melody", "마이멜로디", "1월 18일", "마리랜드의 숲", "O형", "1975"],
  [3, 4, "Pandapple", "판다플", "6월 2일", "중국 상하이", "불명", "2002"],
  [3, 5, "Ahiru no Pekkle", "오리 페클", "7월 27일", "오스트레일리아", "불명", "1989"],
  [3, 6, "Pochacco", "포차코", "2월 29일", "둥실둥실 마을 변두리 꾀꼬리 마을", "B형", "1989"],
  [3, 7, "Pompompurin", "폼폼푸린", "4월 16일", "주인 누나 집 현관 바구니", "불명", "1996"],
  [3, 8, "Pink no Corisu", "핑크노코리스", "7월 7일", "핑쿠루 별(Pinkuru Planet)", "불명", "1998"],
  [4, 1, "Shinkansen", "신칸센", "불명", "일본(철도)", "불명", "1999"],
  [4, 2, "Spottie Dottie", "스포티도티", "3월 21일", "미국 뉴욕", "불명", "1990"],
  [4, 3, "Balletusa & Primausa", "슈가미뉴에트", "11월 17일", "슈가월드", "불명", "2008"],
  [4, 4, "Shirousa & Kurousa", "슈가바니즈", "5월 26일", "버니즈필드(트윈 월드)", "불명", "2004"],
  [4, 5, "Sweet Coron", "스위트코론", "3월 28일", "스위트 타운", "불명", "2001"],
  [4, 6, "Tenorikuma", "테노리쿠마", "불명", "테노리쿠마 커피 카페", "불명", "2005"],
  [4, 7, "U*SA*HA*NA", "우사하나", "8월 7일", "남쪽 섬", "불명", "2000"],
  [4, 8, "Nemukko Nyago", "네무코냐고", "5월 25일", "일본의 어느 곳", "불명", "2000"],
  [5, 1, "Tuxedo Sam", "턱시도샘", "5월 12일", "남극 턱시도 아일랜드", "O형", "1979"],
  [5, 2, "Robow@n", "로보완", "11월 11일", "일본 연구소", "불명", "2000"],
  [5, 3, "Hoshinowaguma", "호시노와구마", "2월 7일", "아주 작은 별", "불명", "2001"],
  [5, 4, "Kobuta no Pippo", "아기돼지 피포", "12월 16일", "일본", "불명", "1993"],
  [5, 5, "PataPataPeppy", "파타파타페피", "8월 26일", "북쪽의 숲", "불명", "1992"],
  [5, 6, "Picke Bicke", "피케비케", "1월 1일", "산리오 퓨로랜드 꽃밭", "불명", "1996"],
  [5, 7, "Patty & Jimmy", "패티앤지미", "패티 2월 5일 / 지미 7월 30일", "미국 캔자스시티", "패티 AB형 / 지미 A형", "1974"],
  [5, 8, "Pururun Kyupi", "푸루룽 큐피", "불명", "푸루룽 호수", "불명", "2000"]
];

function getVersionSuffix() {
  return (typeof window !== 'undefined' && window.CACHE_BUST) ? `?v=${window.CACHE_BUST}` : '';
}

function encodeRelativeAssetPath(relPath) {
  return relPath
    .split('/')
    .map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg)))
    .join('/');
}

function buildSanrioObjects(rawRows) {
  const v = getVersionSuffix();
  return rawRows.map((cols, idx) => {
    const fileIdx = String(idx + 1).padStart(2, '0');
    return {
      domain: 'sanrio',
      charId: idx,
      row: Number(cols[0]),
      col: Number(cols[1]),
      enName: String(cols[2] || '').trim(),
      koName: String(cols[3] || '').trim(),
      birthday: String(cols[4] || '불명').trim(),
      birthplace: String(cols[5] || '불명').trim(),
      bloodType: String(cols[6] || '불명').trim(),
      debutYear: String(cols[7] || '불명').trim(),
      imageUrl: `./characters/cropped/${fileIdx}.png${v}`
    };
  });
}

function buildTeeniepingObjects(rawRows) {
  const v = getVersionSuffix();
  return rawRows.map((cols, idx) => {
    const rawImgPath = String(cols[9] || '').trim().replace(/\\/g, '/');
    const encodedSubPath = encodeRelativeAssetPath(rawImgPath);
    return {
      domain: 'teenieping',
      charId: idx,
      row: Number(cols[0]),
      col: Number(cols[1]),
      koName: String(cols[2] || '').trim(),
      enName: '',
      season: String(cols[3] || '').trim(),
      seasonTheme: String(cols[4] || '').trim(),
      grade: String(cols[5] || '일반').trim(),
      firstAppear: String(cols[6] || '').trim(),
      lastAppear: String(cols[7] || '').trim(),
      note: String(cols[8] || '').trim(),
      imageUrl: `./characters/${encodedSubPath}${v}`
    };
  });
}

const datasetsByDomain = {
  sanrio: buildSanrioObjects(DEFAULT_SANRIO_RAW),
  teenieping: []
};

let isDatasetsLoaded = false;

async function fetchTsvRows(filePath, minCols) {
  const v = getVersionSuffix();
  const res = await fetch(`${filePath}${v}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} (${filePath})`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const delimiter = lines[i].includes('\t') ? '\t' : ',';
    const parts = lines[i].split(delimiter);
    if (parts.length >= minCols) {
      rows.push(parts);
    }
  }
  rows.sort((a, b) => (Number(a[0]) - Number(b[0])) || (Number(a[1]) - Number(b[1])));
  return rows;
}

/**
 * sanrio.cvs 및 Teenieping.cvs 데이터를 비동기로 로드하여 메모리에 적재한다.
 */
export async function loadCharacterDataset() {
  if (isDatasetsLoaded && datasetsByDomain.teenieping.length > 0) {
    return datasetsByDomain;
  }

  await Promise.all([
    fetchTsvRows('./characters/sanrio.cvs', 8)
      .then((rows) => {
        if (rows.length > 0) datasetsByDomain.sanrio = buildSanrioObjects(rows);
      })
      .catch((err) => {
        console.warn('[CharacterData] sanrio.cvs 로드 생략 (폴백 사용):', err.message);
      }),
    fetchTsvRows('./characters/Teenieping.cvs', 10)
      .then((rows) => {
        if (rows.length > 0) datasetsByDomain.teenieping = buildTeeniepingObjects(rows);
      })
      .catch((err) => {
        console.error('[CharacterData] Teenieping.cvs 로드 실패:', err.message);
      })
  ]);

  isDatasetsLoaded = true;
  return datasetsByDomain;
}

/**
 * 도메인 및(티니핑의 경우) 시즌 범위에 해당하는 캐릭터 목록을 반환한다.
 * @param {'sanrio'|'teenieping'} [domain='sanrio']
 * @param {string} [seasonFilter='all']
 * @returns {Array<object>}
 */
export function getCharacters(domain = 'sanrio', seasonFilter = 'all') {
  const list = datasetsByDomain[domain] || [];
  if (domain === 'teenieping' && seasonFilter && seasonFilter !== 'all') {
    return list.filter((item) => item.season === seasonFilter);
  }
  return list;
}

/**
 * 도메인과 마스터 charId로 단일 캐릭터 메타데이터를 조회한다.
 * @param {number|string} charId
 * @param {'sanrio'|'teenieping'} [domain='sanrio']
 * @returns {object|null}
 */
export function getCharacterById(charId, domain = 'sanrio') {
  const list = datasetsByDomain[domain] || [];
  const id = Number(charId);
  return list[id] || list.find((c) => c.charId === id) || null;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (s) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[s]));
}

/**
 * 캐릭터 표시 텍스트 반환 (티니핑은 항상 한글 기본 이름 반환)
 */
export function getCharacterPlainName(charMeta, nameLang = 'ko') {
  if (!charMeta) return '';
  if (!charMeta.enName) return charMeta.koName;
  if (nameLang === 'en') return charMeta.enName;
  if (nameLang === 'both') return `${charMeta.koName} (${charMeta.enName})`;
  return charMeta.koName;
}

/**
 * 버튼/프롬프트용 캐릭터 이름 HTML 마크업 반환
 */
export function getCharacterNameHtml(charMeta, nameLang = 'ko') {
  if (!charMeta) return '';
  if (!charMeta.enName) {
    return `<span class="char-name-primary">${escapeHtml(charMeta.koName)}</span>`;
  }
  if (nameLang === 'en') {
    return `<span class="char-name-primary">${escapeHtml(charMeta.enName)}</span>`;
  }
  if (nameLang === 'both') {
    return `
      <span class="char-name-stack">
        <span class="char-name-primary">${escapeHtml(charMeta.koName)}</span>
        <span class="char-name-sub">${escapeHtml(charMeta.enName)}</span>
      </span>
    `;
  }
  return `<span class="char-name-primary">${escapeHtml(charMeta.koName)}</span>`;
}

/**
 * 도감 상세 모달 및 관전 모드에서 사용할 부제목과 4종 프로필 항목 배열을 반환한다.
 * @param {object} meta
 * @returns {{ subtitle: string, badgeNo: string, fields: Array<{label: string, value: string}> }}
 */
export function getCharacterProfileSpec(meta) {
  if (!meta) return { subtitle: '', badgeNo: '', fields: [] };

  const badgeNo = `#${String(meta.charId + 1).padStart(meta.domain === 'teenieping' ? 3 : 2, '0')} · ${meta.row}행 ${meta.col}열`;

  if (meta.domain === 'teenieping') {
    const themePart = meta.seasonTheme ? ` · ${meta.seasonTheme}` : '';
    const notePart = meta.note ? ` (${meta.note})` : '';
    const gradeLabel = (meta.grade && meta.grade !== meta.season)
      ? ` · ${meta.grade} 티니핑`
      : ' 티니핑';
    return {
      badgeNo,
      subtitle: `${meta.season}${themePart}${gradeLabel}${notePart}`,
      fields: [
        { label: '📺 시즌 / 테마', value: meta.seasonTheme ? `${meta.season} (${meta.seasonTheme})` : meta.season },
        { label: '👑 등급 / 비고', value: meta.note ? `${meta.grade} · ${meta.note}` : (meta.grade || '일반') },
        { label: '🎬 첫 등장', value: meta.firstAppear || '정보 없음' },
        { label: '🎞️ 마지막 등장', value: meta.lastAppear || '활약 중 / 미정' }
      ]
    };
  }

  return {
    badgeNo,
    subtitle: meta.enName || '',
    fields: [
      { label: '🎂 생일', value: meta.birthday || '불명' },
      { label: '📅 출시연도', value: meta.debutYear ? `${meta.debutYear}년` : '불명' },
      { label: '🩸 혈액형', value: meta.bloodType || '불명' },
      { label: '📍 출생지', value: meta.birthplace || '불명' }
    ]
  };
}

const preloadedImageCache = new Map();

/**
 * 세션 시작 전 출제 풀의 캐릭터 이미지를 브라우저에 프리로딩한다. (최대 동시 24장으로 제한해 대용량 풀에서도 쾌적하게 처리)
 * @param {Array<object>} pool
 */
export async function preloadCharacterImages(pool = []) {
  const slice = pool.slice(0, 24);
  const tasks = slice.map((item) => {
    const meta = item.imageUrl ? item : getCharacterById(item.charId, item.domain);
    if (!meta || !meta.imageUrl || preloadedImageCache.has(meta.imageUrl)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        preloadedImageCache.set(meta.imageUrl, img);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = meta.imageUrl;
    });
  });
  await Promise.all(tasks);
}
