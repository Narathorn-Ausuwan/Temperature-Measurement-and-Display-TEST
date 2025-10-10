// Prepare all the libraries
const express = require('express');
const {InfluxDB, Point} = require('@influxdata/influxdb-client');
require('dotenv').config();

// Create variables for conveniently use
const app = express();
const PORT = process.env.PORT || 3000; // Port will be the render's port, value = 3000 if null

app.use(express.json());
app.use(express.static('public'));

// Get all the important datas from env
const influxURL = process.env.INFLUX_URL;
const influxToken = process.env.INFLUX_TOKEN;
const influxOrg = process.env.INFLUX_ORG;
const influxBucket = process.env.INFLUX_BUCKET;

// Create variables for query and write data to the influxDB
const influxDB = new InfluxDB({ url: influxURL, token: influxToken });
const writeApi = influxDB.getWriteApi(influxOrg, influxBucket);
const queryApi = influxDB.getQueryApi(influxOrg);

// Create Endpoint
app.post('/api/sensorReading', async (req, res) => {
  const clientApiKey = req.headers['api-key'];
  if (!clientApiKey || clientApiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  const { deviceId, deviceName, location, temperature, humidity } = req.body;
  if (!deviceId || temperature === undefined || humidity === undefined) {
    return res.status(400).json({ error: 'Missing required data.' });
  }
  const point = new Point('sensor_readings')
        .tag('deviceId', deviceId).tag('deviceName', deviceName || 'Unknown').tag('location', location || 'Unknown')
        .floatField('temperature', parseFloat(temperature)).floatField('humidity', parseFloat(humidity));
    
    try {
        writeApi.writePoint(point);
        await writeApi.flush(); // <-- เพิ่มบรรทัดนี้เพื่อบังคับให้ส่งข้อมูลทันที
        console.log(`[INFO] Write SUCCESS for device: ${deviceId}`);
        res.status(201).json({ message: 'Data logged and flushed.' });
    } catch (error) {
        console.error('Error writing to InfluxDB:', error);
        res.status(500).json({ error: 'Failed to log data to InfluxDB.' });
    }
});

app.get('/api/readings/latest', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -30d) |> filter(fn: (r) => r._measurement == "sensor_readings") |> last()`;
  const data = await queryApi.collectRows(query);
  res.json(data.length > 0 ? data[0] : {});
});

app.get('/api/readings/history', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -30d) |> filter(fn: (r) => r._measurement == "sensor_readings") |> sort(columns: ["_time"], desc: true) |> limit(n: 20)`;
  res.json(await queryApi.collectRows(query));
});

app.get('/api/stats/hourly-average', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -24h) |> filter(fn: (r) => r._measurement == "sensor_readings" and r._field == "temperature") |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)`;
  res.json(await queryApi.collectRows(query));
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});