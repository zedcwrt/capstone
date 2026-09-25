const mqtt = require('mqtt')

const MAX_HISTORY = 100
const topic = process.env.MQTT_TOPIC || 'health-monitor/sensors'

// URL HiveMQ lu langsung di-hardcode sebagai fallback kalo .env kosong[cite: 4]
const DEFAULT_BROKER_URL = 'mqtts://a4f2c2c7a33540f88424719acac8ccc4.s1.cu.hivemq.cloud:8883'

function getSanitizedBrokerUrl() {
  let url = process.env.MQTT_BROKER_URL || DEFAULT_BROKER_URL
  url = url.trim()

  // Nambahin protokol otomatis kalo kelupaan
  if (!/^((mqtt|mqtts|ws|wss):\/\/)/i.test(url)) {
    url = `mqtts://${url}`
  }
  return url
}

const brokerUrl = getSanitizedBrokerUrl()
const history = []
const clients = new Set()
let lastData = null
let connected = false

// Parser fleksibel (Bisa bca CSV maupun JSON)
function parsePayload(payload) {
  const str = payload.toString().trim()
  if (!str) throw new Error('Payload kosong')

  let hr, spo2, temp, heartStatus, tempStatus

  if (str.startsWith('{')) {
    const data = JSON.parse(str)
    hr = Number(data.heart_rate ?? data.hr ?? data.bpm)
    spo2 = Number(data.spo2)
    temp = Number(data.body_temp ?? data.temp ?? data.temperature)
    heartStatus = String(data.heartStatus ?? data.heart_status ?? 'Normal').trim()
    tempStatus = String(data.tempStatus ?? data.temp_status ?? 'Normal').trim()
  } else {
    const parts = str.split(',')
    if (parts.length !== 5) throw new Error('Payload CSV harus memiliki 5 field')
    ;[hr, spo2, temp, heartStatus, tempStatus] = parts.map(p => p.trim())
    hr = Number(hr)
    spo2 = Number(spo2)
    temp = Number(temp)
  }

  const values = [hr, spo2, temp]
  if (!values.every(Number.isFinite)) throw new Error('Nilai sensor tidak valid / NaN')
  if (values[0] < 0 || values[0] > 250 || values[1] < 0 || values[1] > 100 || values[2] < -40 || values[2] > 125) {
    throw new Error('Nilai sensor di luar rentang wajar')
  }
  if (!heartStatus || !tempStatus) throw new Error('Status sensor kosong')

  return {
    heart_rate: values[0],
    spo2: values[1],
    body_temp: values[2],
    heartStatus,
    tempStatus,
    health_status: heartStatus === 'Normal' && tempStatus === 'Normal' ? 'Normal' : `${heartStatus} / ${tempStatus}`,
    timestamp: new Date().toISOString()
  }
}

function publish(record) {
  lastData = record
  history.push(record)
  if (history.length > MAX_HISTORY) history.shift()
  
  const message = `data: ${JSON.stringify(record)}\n\n`
  for (const client of clients) {
    try {
      client.write(message)
    } catch (err) {
      clients.delete(client)
    }
  }
}

function connect() {
  console.log(`[mqtt] Menghubungkan ke broker: ${brokerUrl}`)

  const client = mqtt.connect(brokerUrl, {
    clientId: process.env.MQTT_CLIENT_ID || `health-monitor-backend-${Math.random().toString(16).slice(2)}`,
    // MASUKIN USERNAME DAN PASSWORD HIVEMQ LU DI BAWAH INI KALO GA PAKE .ENV:
    username: process.env.MQTT_USERNAME || 'admin_cardiotemp',
    password: process.env.MQTT_PASSWORD || 'VWJeYMp5twME4Ee',
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    clean: true,
    protocolVersion: 4,
    rejectUnauthorized: true,
  })

  client.on('connect', () => {
    connected = true
    console.log(`[mqtt] SUKSES! Terhubung ke HiveMQ | Subscribe topic: ${topic}`)
    client.subscribe(topic, { qos: 1 }, error => {
      if (error) console.error('[mqtt] Subscribe gagal:', error.message)
      else console.log('[mqtt] Subscribe berhasil disiapkan!')
    })
  })

  client.on('reconnect', () => {
    connected = false
    console.log('[mqtt] Koneksi terputus, mencoba reconnect...')
  })

  client.on('offline', () => { connected = false })
  client.on('close', () => { connected = false })
  
  client.on('error', error => {
    connected = false
    console.error('[mqtt] Error Koneksi Broker:', error.message)
  })

  client.on('message', (receivedTopic, payload) => {
    if (receivedTopic !== topic) return
    try {
      const parsed = parsePayload(payload)
      publish(parsed)
    } catch (error) {
      console.error('[mqtt] Payload diabaikan:', error.message)
    }
  })
}

function snapshot() {
  return {
    data: lastData,
    history: history.slice(-30),
    total: history.length,
    connected,
    topic,
    timestamp: new Date().toISOString()
  }
}

function addClient(res) {
  clients.add(res)
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
  
  const cleanup = () => clients.delete(res)
  res.on('close', cleanup)
  res.on('error', cleanup)
}

connect()

module.exports = {
  topic,
  snapshot,
  addClient,
  publish,
  get connected() { return connected }
}
