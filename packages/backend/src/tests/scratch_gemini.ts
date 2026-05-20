import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const apiKey = process.env.OPENROUTER_API_KEY;
const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
const model = 'gemini-2.5-flash';

async function testParam(payloadExtra: any) {
  console.log(`\nTesting with:`, JSON.stringify(payloadExtra));
  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model,
        messages: [
          { role: 'user', content: 'Write a very long essay about the history of the internet. Write at least 10 paragraphs. Do not stop early.' }
        ],
        ...payloadExtra
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    const content = response.data.choices[0]?.message?.content || '';
    console.log(`Success! Length: ${content.length} chars`);
    console.log(`Finish reason:`, response.data.choices[0]?.finish_reason);
    console.log(`Usage:`, response.data.usage);
  } catch (error: any) {
    console.error(`Error:`, error.response?.status, error.response?.data);
  }
}

async function run() {
  await testParam({ max_tokens: 5000 });
}

run();
