var map;
var source;
var quake, longitude, latitude;
var stations;
var popupHTML;
var popup; // 暗黙のグローバル変数を回避するため宣言
var chart;

// 度分秒表記（例: 137°00.0’）を十進法座標に変換するヘルパー関数
const parseCoordinates = (coordStr) => {
    if (!coordStr) return 0;
    const parts = coordStr.replace('°', '/').replace('’', '/').split('/');
    return Number(parts[0]) + (Number(parts[1]) / 60);
};

// 最大震度を取得するヘルパー関数
const getMaxIntensity = (intObj) => {
    if (!intObj) return '';
    const firstEntry = Object.entries(intObj)[0];
    return firstEntry ? toIntText(firstEntry[1]) : '';
};

// 地図初期化
const initMap = () => {
    return new Promise((resolve) => {
        console.time('initMap');
        chart = new SeismicScatterPlot('seismicCanvas');
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        
        map = new maplibregl.Map({
            container: 'map',
            center: [137.0, 38.0],
            zoom: 9,
            minZoom: 5,
            maxZoom: 14,
            attributionControl: false,
            style: './styles/style.json'
        });

        if (!document.cookie.includes('icon')) document.cookie = 'icon=jma';
        
        popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 15
        });

        map.on('mousemove', 'points-layer', (e) => {
            if (e.features.length > 0) {
                map.getCanvas().style.cursor = 'pointer';

                const coordinates = e.features[0].geometry.coordinates.slice();
                const props = e.features[0].properties;

                if (popupHTML === props.popup) return;
                popupHTML = props.popup;

                while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                }
                popup.setLngLat(coordinates).setHTML(popupHTML).addTo(map);
            }
        });

        map.on('mouseleave', 'points-layer', () => {
            map.getCanvas().style.cursor = '';
            popup.remove();
            popupHTML = null;
        });

        map.on('click', 'epicenter-layer', (e) => {
            const coordinates = e.features[0].geometry.coordinates.slice();

            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }

            new maplibregl.Popup()
                .setLngLat(coordinates)
                .setHTML(e.features[0].properties.popup)
                .addTo(map);
        });

        map.on('mouseenter', 'epicenter-layer', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'epicenter-layer', () => {
            map.getCanvas().style.cursor = '';
        });

        console.timeEnd('initMap');
        resolve();
    });
};

// 画像を読み込む
const loadImages = () => {
    return new Promise((resolve) => {
        console.time('loadImages');
        
        const images = [
            { id: 'epicenter', url: 'images/epicenter.png' },
            { id: 'epicenter_white', url: 'images/epicenter_white.png' }
        ];

        const iconExt = document.cookie.includes('icon=kmoni') ? '.svg' : '.gif';
        const iconDir = document.cookie.includes('icon=kmoni') ? 'images/kmoni/' : 'images/jma/';
        for (let i = 5; i <= 69; i++) {
            const intStr = (i / 10).toFixed(1);
            images.push({ id: `intensity-${intStr}`, url: `${iconDir}S${intStr}${iconExt}` });
        }

        const promises = images.map(img => {
            return new Promise((res) => {
                if (img.url.endsWith('.svg')) {
                    const htmlImg = new Image();
                    htmlImg.onload = () => {
                        if (!map.hasImage(img.id)) map.addImage(img.id, htmlImg);
                        res();
                    };
                    htmlImg.onerror = () => {
                        console.warn(`SVG Load Error: ${img.url}`);
                        res();
                    };
                    htmlImg.src = img.url;
                } else {
                    map.loadImage(img.url)
                        .then(image => {
                            if (!map.hasImage(img.id)) {
                                map.addImage(img.id, image.data);
                            }
                            res();
                        })
                        .catch(err => {
                            console.warn(`Image Load Error: ${img.url}`, err);
                            res();
                        });
                }
            });
        });

        Promise.all(promises).then(() => {
            console.timeEnd('loadImages');
            resolve();
        });
    });
};

// 地震取得
const getQuake = async () => {
    console.time('getQuake');
    const targetFile = location.hash.split('.')[0].replace('#', '') + '.json';
    const res = await fetch(targetFile);
    const quakes = await res.json();
    
    quake = quakes.find(d => d.id == location.hash.split('.')[1]);
    
    longitude = parseCoordinates(quake.longitude);
    latitude = parseCoordinates(quake.latitude);
    console.timeEnd('getQuake');
};

// ソース取得
const getSources = async () => {
    console.time('getSources');
    const res = await fetch('sources.json');
    const sources = await res.json();
    
    source = sources.find(d => d.name == location.hash.split('.')[0].replace('#', ''));
    map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '地図データ: 気象庁GISデータ, Natural Earth<br>カラースキーム: ' + 
            (document.cookie.includes('icon=kmoni') ? '<a href="https://github.com/ingen084/KyoshinShindoColorMap" target="_blank">ingen084/KyoshinShindoColorMap</a>' : '気象庁') + 
            '<br>震度データ: <a href="' + source.source.link + '" target="_blank">' + source.source.name + '</a>'
    }), 'bottom-right');
    
    document.title = source.year + '年' + source.month + '月#' + quake.id + '(最大震度' + toIntText(Object.entries(quake.int)[0][1]) + ') - 計測震度データベース';
    console.timeEnd('getSources');
};

// 観測点データファイル取得
const fetchStationData = (date) => {
    return fetch('stations.json'); 
};

// 震度観測点データ取得
const getStationsData = async () => {
    console.time('getStationsData');
    const res = await fetchStationData(
        new Date(source.year + '/' + source.month + '/' + quake.days + ' ' + quake.hours + ':' + quake.minutes + ':00+0900')
    );
    stations = await res.json();
    console.timeEnd('getStationsData');
};

// 震央描画
const drawEpicenter = async () => {
    console.time('drawEpicenter');
    const features = [];
    const maxInt = getMaxIntensity(quake.int);

    // ポップアップ用HTML構築ヘルパー（指定順序: 震源名(大) -> 時刻 -> 深さ -> M -> 最大震度）
// ポップアップ用HTML構築ヘルパー（指定順序: 震源名(大) -> 時刻 -> 深さ -> M -> 最大震度）
    const createEpicenterPopup = (qName, days, hours, minutes, depth, mag, maxIntensity) => {
    // 1桁の月日時分を2桁埋め（例: 8 -> 08）にする処理
        const mStr = String(source.month).padStart(2, '0');
        const dStr = String(days).padStart(2, '0');
        const hStr = String(hours).padStart(2, '0');
        const minStr = String(minutes).padStart(2, '0');
    
    // 2026/08/17 18:27 形式の文字列を作成
        const formattedDate = `${source.year}/${mStr}/${dStr} ${hStr}:${minStr}`;

        return `
            <div style="font-weight: bold; font-size: 1.5em; margin-bottom: 4px;">${qName}</div>
            <div style="font-weight: bold; font-size: 14px; line-height: 1.5;">
                時刻: ${formattedDate}<br>
                深さ: ${depth}<br>
                マグニチュード: ${mag ? 'M' + mag : '不明'}<br>
                最大震度: ${maxIntensity ? '震度' + maxIntensity : '不明'}
            </div>
`.trim();
    };
    // 主震源
    features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
        properties: { 
            icon: 'epicenter',
            zIndex: 71,
            size: 40 / 491,
            popup: createEpicenterPopup(quake.epicentername, quake.days, quake.hours, quake.minutes, quake.depth, quake.magnitude, maxInt)
        }
    });

    map.setCenter([longitude, latitude]);
    map.setZoom(7);

    const tableEl = document.getElementById('table-earthquakes');
    if (tableEl) {
        tableEl.innerHTML = `<tr><td>${source.year}/${source.month}/${quake.days} ${quake.hours}:${quake.minutes}</td><td>${quake.epicentername}</td><td>${quake.latitude}</td><td>${quake.longitude}</td><td>${quake.depth}</td><td>${quake.magnitude ?? ''}</td></tr>`;
    }

    if (quake.earthquakes) {
        for (const q of quake.earthquakes) {
            if (tableEl) {
                tableEl.innerHTML += `<tr><td>${source.year}/${source.month}/${q.days} ${q.hours}:${q.minutes}</td><td>${q.epicentername}</td><td>${q.latitude}</td><td>${q.longitude}</td><td>${q.depth}</td><td>${q.magnitude ?? ''}</td></tr>`;
            }
            
            const qLng = parseCoordinates(q.longitude);
            const qLat = parseCoordinates(q.latitude);

            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [qLng, qLat] },
                properties: { 
                    icon: 'epicenter_white',
                    zIndex: 70,
                    size: 30 / 69,
                    popup: createEpicenterPopup(q.epicentername, q.days, q.hours, q.minutes, q.depth, q.magnitude, maxInt)
                }
            });
        }
    }

    map.addSource('epicenter-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    map.addLayer({
        id: 'epicenter-layer',
        type: 'symbol',
        source: 'epicenter-source',
        layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['get', 'size'],
            'icon-allow-overlap': true
        }
    });

    console.timeEnd('drawEpicenter');
};

// 観測点描画
const drawPoints = async () => {
    console.time('drawPoints');
    const features = [];
    var intList = {};
    var chartData = [];

    const stationAliases = {
        "横浜泉区和泉町": "横浜泉区和泉中央北"
    };

    for (const point of Object.entries(quake.int)) {
        var rawName = point[0]
            .replace(/[＊*]/g, '')
            .replace(/\(旧[０１２３４５６７８９0-9]*\)/g, '')
            .replace(/[\s ]/g, '');

        var targetName = stationAliases[rawName] || rawName;

        var station = stations.find(d => {
            var stationName = d.name
                .replace(/[＊*]/g, '')
                .replace(/\(旧[０１２３４５６７８９0-9]*\)/g, '')
                .replace(/[\s ]/g, '');
            return stationName === targetName;
        });

        if (!station) {
            console.log('観測点 "' + point[0] + '" の詳細情報を確認できませんでした');
            const modalEl = document.getElementById('modalbody');
            if (modalEl) {
                modalEl.innerHTML = '<div class="uk-alert-danger" uk-alert><p>' + '観測点 "' + point[0] + '" の詳細情報を確認できなかったため、表示していません。</p></div>' + modalEl.innerHTML;
            }
            continue;
        }

        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
            properties: { 
                icon: 'intensity-' + point[1],
                zIndex: point[1] * 10,
                size: 20 / 50,
                popup: point[0] + '=' + point[1]
            }
        });

        if (!intList[station.pref.name]) { intList[station.pref.name] = {}; }
        if (!intList[station.pref.name][toIntText(point[1])]) { intList[station.pref.name][toIntText(point[1])] = ''; }
        intList[station.pref.name][toIntText(point[1])] += point[0] + '=' + point[1] + ' ';
        chartData.push({ name: point[0], intensity: Number(point[1]), distance: calcDistance(station.lat, station.lon, latitude, longitude) });
    }

    const intensitiesTable = document.getElementById('table-intensities');
    if (intensitiesTable) {
        for (const pref of Object.entries(intList)) {
            for (const int of Object.entries(pref[1])) {
                intensitiesTable.innerHTML += '<tr><td>' + pref[0] + '</td><td>' + toIntLabel(int[0]) + '</td><td>' + int[1] + '</td></tr>';
            }
        }
    }

    map.addSource('points-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: features }
    });

    map.addLayer({
        id: 'points-layer',
        type: 'symbol',
        source: 'points-source',
        layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['get', 'size'],
            'symbol-sort-key': ['get', 'zIndex'],
            'icon-allow-overlap': true
        }
    }, 'epicenter-layer');

    chart.draw(chartData);
    console.timeEnd('drawPoints');
};

// サイドボタン設定
const setSideButtons = async () => {
    console.time('setSideButtons');
    document.getElementById('pdfbtn')?.setAttribute('href', source.source.link);
    document.getElementById('listbtn')?.setAttribute('href', 'list.html#' + source.name);
    document.getElementById('dbbtn')?.setAttribute('href', 'https://www.data.jma.go.jp/svd/eqdb/data/shindo/index.html#' + quake.dbid);
    console.timeEnd('setSideButtons');
};

// 補足情報取得
const getNotes = async () => {
    console.time('getNotes');
    const res = await fetch('notes.json');
    const data = await res.json();
    
    if (data.notes && data.notes[quake.dbid]) {
        const note = data.notes[quake.dbid];
        const notesEl = document.getElementById('notes');
        if (notesEl) {
            notesEl.innerHTML = `<div uk-alert>
                <h3><span class="uk-text-small uk-text-muted">補足情報</span> ${note.title ? note.title : ''}</h3>
                <p>${note.content}</p>
                ${note.links.map(a => `<a href="${a[1]}" target="_blank">${a[0]}</a>`).join('<br>')}
            </div>`;
        }
    }
    console.timeEnd('getNotes');
};

// アイコンdiv作成
function makeMarkerIcon(img, w, h, cursor, tooltip, zindex) {
    const el = document.createElement('div');
    el.className = 'marker';
    el.style.backgroundImage = `url(${img})`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.backgroundSize = '100%';
    if (cursor) { el.style.cursor = 'pointer'; }
    if (tooltip) { el.setAttribute('uk-tooltip', tooltip); }
    el.style.zIndex = zindex;
    return el;
}

// 計測震度から震度階級テキストに変換
function toIntText(int) {
    if (int < 0.5) return '０';
    if (int < 1.5) return '１';
    if (int < 2.5) return '２';
    if (int < 3.5) return '３';
    if (int < 4.5) return '４';
    if (int < 5.0) return '５弱';
    if (int < 5.5) return '５強';
    if (int < 6.0) return '６弱';
    if (int < 6.5) return '６強';
    return '７';
}

function toIntLabel(int) {
    if (int == '０') return '<span class="uk-label">震度０</span>';
    if (int == '１') return '<span class="uk-label" style="background: #f2f2ff; color: black;">震度１</span>';
    if (int == '２') return '<span class="uk-label" style="background: #00aaff; color: black;">震度２</span>';
    if (int == '３') return '<span class="uk-label" style="background: #0041ff; color: white;">震度３</span>';
    if (int == '４') return '<span class="uk-label" style="background: #fae696; color: black;">震度４</span>';
    if (int == '５弱') return '<span class="uk-label" style="background: #ffe600; color: black;">震度５弱</span>';
    if (int == '５強') return '<span class="uk-label" style="background: #ff9900; color: black;">震度５強</span>';
    if (int == '６弱') return '<span class="uk-label" style="background: #ff2800; color: white;">震度６弱</span>';
    if (int == '６強') return '<span class="uk-label" style="background: #a50021; color: white;">震度６強</span>';
    return '<span class="uk-label" style="background: #b40068; color: white;">震度７</span>';
}

const R = Math.PI / 180;
function calcDistance(lat1, lng1, lat2, lng2) {
    lat1 *= R;
    lng1 *= R;
    lat2 *= R;
    lng2 *= R;
    return 6371 * Math.acos(Math.cos(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1) + Math.sin(lat1) * Math.sin(lat2));
}

// 実行フロー
initMap()
    .then(() => {
        return new Promise(resolve => {
            if (map.loaded()) resolve();
            else map.once('load', resolve);
        });
    })
    .then(loadImages)
    .then(getQuake)
    .then(getSources)
    .then(getStationsData)
    .then(drawEpicenter)
    .then(drawPoints)
    .then(setSideButtons)
    .then(getNotes)
    .then(() => {
        if (window.gtag) {
            gtag('event', 'view_earthquake', {
                earthquake_id: quake.dbid,
                send_to: 'G-GRQELX997W'
            });
        }
    });