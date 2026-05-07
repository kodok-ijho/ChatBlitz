import express from 'express';
import cors from 'cors';

import { handleWahaWebhook } from './wahaWebhookController.ts';
import { saveWorkflow } from './workflowController.ts';

export const app = express();

app.use(
  cors({
    origin: [
      process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/webhook/waha', handleWahaWebhook);
app.post('/api/webhook/waha', handleWahaWebhook);
app.post('/api/workflows', saveWorkflow);

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`AI Chat Agent webhook server listening on port ${port}`);
});
