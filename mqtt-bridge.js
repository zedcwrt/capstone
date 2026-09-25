const mqtt = require('mqtt')

const MAX_HISTORY = 100
const topic = process.env.MQTT_TOPIC || 'health-monitor/sensors'
const brokerUrl = process.env.MQTT_BROKER_URL || buildBrokerUrl()
const history = []

function buildBrokerUrl() {
  const host = process.env.MQTT_HOST
  if (!host) return ''
  const port = Number(process.env.MQTT_PORT || 8883)
  const protocol = process.env.MQTT_TLS === 'false' || port === 1883 ? 'mqtt' : 'mqtts'
  return `${protocol}://${host}:${port}`
}
const clients = new Set()
let lastData = null
let connected = false

function parsePayload(payload) {
  const parts = payload.toString().trim().split(',')
  if (parts.length !== 5) throw new Error('Payload CSV harus memiliki 5 field')
  const [hr, spo2, temp, heartStatus, tempStatus] = parts
  const values = [Number(hr), Number(spo2), Number(temp)]
  if (!values.every(Number.isFinite)) throw new Error('Nilai sensor tidak valid')
  if (values[0] < 0 || values[0] > 250 || values[1] < 0 || values[1] > 100 || values[2] < -40 || values[2] > 125) throw new Error('Nilai sensor di luar rentang')
  const normalizedHeartStatus = heartStatus.trim()
  const normalizedTempStatus = tempStatus.trim()
  if (!normalizedHeartStatus || !normalizedTempStatus) throw new Error('Status sensor kosong')
  return { heart_rate: values[0], spo2: values[1], body_temp: values[2], heartStatus: normalizedHeartStatus, tempStatus: normalizedTempStatus, health_status: normalizedHeartStatus === 'Normal' && normalizedTempStatus === 'Normal' ? 'Normal' : `${normalizedHeartStatus} / ${normalizedTempStatus}`, timestamp: new Date().toISOString() }
}

function publish(record) {
  lastData = record
  history.push(record)
  if (history.length > MAX_HISTORY) history.shift()
  const message = `data: ${JSON.stringify(record)}\n\n`
  for (const client of clients) client.write(message)
}

function connect() {
  if (!brokerUrl) {
    console.warn('[mqtt] MQTT_BROKER_URL belum diatur; bridge berjalan tanpa koneksi broker')
    return
  }
  const client = mqtt.connect(brokerUrl, {
    clientId: process.env.MQTT_CLIENT_ID || `health-monitor-backend-${Math.random().toString(16).slice(2)}`,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    clean: true,
    protocolVersion: 4,
  })
  client.on('connect', () => {
    connected = true
    console.log(`[mqtt] Terhubung ke ${brokerUrl}; subscribe ${topic}`)
    client.subscribe(topic, { qos: 1 }, error => {
      if (error) console.error('[mqtt] Subscribe gagal:', error.message)
      else console.log('[mqtt] Subscribe berhasil')
    })
  })
  client.on('reconnect', () => { connected = false; console.log('[mqtt] Mencoba reconnect...') })
  client.on('offline', () => { connected = false })
  client.on('close', () => { connected = false })
  client.on('error', error => console.error('[mqtt] Error:', error.message))
  client.on('message', (receivedTopic, payload) => { if (receivedTopic !== topic) return; try { publish(parsePayload(payload)) } catch (error) { console.error('[mqtt] Payload diabaikan:', error.message) } })
}

function snapshot() { return { data: lastData, history: history.slice(-30), total: history.length, connected, topic, timestamp: new Date().toISOString() } }
function addClient(res) { clients.add(res); res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`); res.on('close', () => clients.delete(res)) }
connect()
module.exports = { topic, snapshot, addClient, publish, get connected() { return connected } }
