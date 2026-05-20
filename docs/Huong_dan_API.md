# Hướng dẫn tích hợp API danglamgiau.com / HOCAI vào hệ thống backend

> Tài liệu này được viết để dùng như một hướng dẫn kỹ thuật khi tích hợp API `danglamgiau.com` vào backend cho các use case LLM, chatbot, agent hoặc RAG.
>
> API được trình bày theo kiểu **OpenAI-compatible API**, nghĩa là có thể dùng trực tiếp bằng `curl`, HTTP client thông thường, hoặc SDK tương thích OpenAI bằng cách đổi `base_url`.

---

## 1. Tóm tắt nhanh

### Base URL

```text
https://danglamgiau.com/v1
```

### Endpoint chính

```text
POST https://danglamgiau.com/v1/chat/completions
GET  https://danglamgiau.com/v1/models
```

### Header bắt buộc

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Dòng API key để bạn tự điền

```env
API_key = hocai-dd5ac6a34000a24bbffe12c70a25a2f14fd8349d9fe759a750d9bb481a466182
```

> Khuyến nghị kỹ thuật: trong backend thực tế nên dùng biến môi trường viết hoa, ví dụ:
>
> ```env
> DLG_API_KEY=Insert my API Key here
> DLG_BASE_URL=https://danglamgiau.com/v1
> DLG_MODEL=deepseek-v4-pro
> ```
>
> Dòng `API_key = Insert my API Key here` ở trên được giữ đúng theo yêu cầu để bạn dễ thay API key thủ công.

---

## 2. API này dùng để làm gì?

API `danglamgiau.com` / HOCAI hoạt động như một cổng gọi mô hình LLM. Backend của bạn có thể dùng API này cho các tác vụ như:

- Chatbot hỏi đáp.
- RAG: retrieval-augmented generation.
- Agent backend: lập kế hoạch, gọi tool, tạo phản hồi nhiều bước.
- Tóm tắt tài liệu.
- Phân loại văn bản.
- Trích xuất thông tin có cấu trúc.
- Sinh nội dung.
- Hỗ trợ coding assistant nội bộ.

Điểm quan trọng nhất: API có dạng **OpenAI-compatible**, nên nếu code của bạn đang dùng OpenAI SDK thì thường chỉ cần thay:

```text
base_url = https://danglamgiau.com/v1
api_key  = API key của danglamgiau.com
model    = model được hỗ trợ bởi tài khoản/API
```

---

## 3. Kiến trúc tích hợp backend đề xuất

Một backend production không nên gọi API trực tiếp rải rác ở nhiều nơi. Nên gom toàn bộ logic gọi LLM vào một service riêng.

### Kiến trúc gợi ý

```text
Client / Frontend
        |
        v
Backend API
        |
        |-- Auth middleware
        |-- Rate limit middleware
        |-- Request validation
        |
        v
LLM Service Wrapper
        |
        |-- Build prompt
        |-- Call danglamgiau.com API
        |-- Retry / timeout / error handling
        |-- Logging / tracing
        |
        v
danglamgiau.com / HOCAI API
```

### Với hệ thống RAG

```text
User Query
   |
   v
Backend API
   |
   |-- Normalize query
   |-- Retrieve relevant chunks từ Vector DB
   |-- Build context
   |-- Build system/user prompt
   |-- Call LLM API
   |-- Return answer + citations/sources
```

---

## 4. Luồng gọi API cơ bản

### Bước 1: Lấy API key

Bạn cần API key từ tài khoản/dịch vụ của `danglamgiau.com`.

Không hardcode API key trực tiếp trong code.

Sai:

```js
const apiKey = "sk-xxxxxxxx";
```

Đúng:

```js
const apiKey = process.env.DLG_API_KEY;
```

---

### Bước 2: Kiểm tra danh sách model

Gọi endpoint:

```bash
curl https://danglamgiau.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Mục đích:

- Kiểm tra API key có hoạt động không.
- Xem danh sách model hiện có.
- Chọn đúng tên model trước khi gọi chat completions.
- Tránh hardcode model không còn được hỗ trợ.

Ví dụ response thường gặp với API tương thích OpenAI:

```json
{
  "object": "list",
  "data": [
    {
      "id": "deepseek-v4-pro",
      "object": "model"
    }
  ]
}
```

> Lưu ý: tên model thực tế có thể thay đổi theo tài khoản, gói dịch vụ hoặc thời điểm. Backend nên cho phép cấu hình model bằng biến môi trường.

---

### Bước 3: Gọi chat completions

```bash
curl https://danglamgiau.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [
      {
        "role": "system",
        "content": "Bạn là một trợ lý AI hữu ích, trả lời ngắn gọn và chính xác."
      },
      {
        "role": "user",
        "content": "Giải thích API backend là gì?"
      }
    ],
    "temperature": 0.3,
    "max_tokens": 1000
  }'
```

---

## 5. Cấu trúc request `/chat/completions`

### Endpoint

```http
POST /v1/chat/completions
```

### Body cơ bản

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {
      "role": "system",
      "content": "Bạn là trợ lý kỹ thuật."
    },
    {
      "role": "user",
      "content": "Viết API service bằng Node.js."
    }
  ],
  "temperature": 0.3,
  "max_tokens": 1200
}
```

---

## 6. Các trường quan trọng trong request

### `model`

Tên model muốn gọi.

Ví dụ:

```json
"model": "deepseek-v4-pro"
```

Không nên hardcode trong code. Nên để trong `.env`:

```env
DLG_MODEL=deepseek-v4-pro
```

---

### `messages`

Danh sách hội thoại gửi vào model.

Mỗi message thường có dạng:

```json
{
  "role": "user",
  "content": "Nội dung câu hỏi"
}
```

Các role phổ biến:

| Role | Ý nghĩa |
|---|---|
| `system` | Thiết lập vai trò, quy tắc, style trả lời |
| `user` | Nội dung từ người dùng |
| `assistant` | Lịch sử câu trả lời trước đó của model |
| `tool` | Kết quả trả về từ tool/function, nếu model/provider hỗ trợ |

Ví dụ:

```json
[
  {
    "role": "system",
    "content": "Bạn là chuyên gia backend. Trả lời bằng tiếng Việt, rõ ràng, có ví dụ code."
  },
  {
    "role": "user",
    "content": "Tạo service gọi LLM API."
  }
]
```

---

### `temperature`

Điều chỉnh mức độ sáng tạo.

| Giá trị | Ý nghĩa |
|---:|---|
| `0.0` - `0.2` | Rất ổn định, phù hợp phân tích kỹ thuật, RAG, trích xuất dữ liệu |
| `0.3` - `0.5` | Cân bằng, phù hợp chatbot/backend thông thường |
| `0.7` - `1.0` | Sáng tạo hơn, phù hợp brainstorm, marketing, viết nội dung |

Khuyến nghị cho backend kỹ thuật/RAG:

```json
"temperature": 0.2
```

---

### `max_tokens`

Giới hạn số token đầu ra.

Ví dụ:

```json
"max_tokens": 1200
```

Khuyến nghị:

- Chat ngắn: `500 - 1000`
- RAG trả lời vừa: `1000 - 2000`
- Tóm tắt dài: `2000 - 4000`, tùy context window/model

---

### `stream`

Bật streaming để backend nhận token dần dần.

```json
"stream": true
```

Dùng khi:

- Làm chatbot realtime.
- Muốn UI hiển thị câu trả lời từng phần.
- Muốn giảm cảm giác chờ của người dùng.

Không cần dùng khi:

- Chạy batch job.
- Tóm tắt tài liệu nền.
- Pipeline cần đợi full response rồi mới xử lý tiếp.

---

## 7. Cấu trúc response cơ bản

Với non-streaming, response thường có dạng tương thích OpenAI:

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "deepseek-v4-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Đây là nội dung trả lời của model."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  }
}
```

Backend thường lấy nội dung tại:

```js
response.choices[0].message.content
```

---

## 8. Ví dụ gọi API bằng Node.js backend

### Cài dependencies

```bash
npm install openai dotenv
```

### File `.env`

```env
API_key = Insert my API Key here

DLG_API_KEY=Insert my API Key here
DLG_BASE_URL=https://danglamgiau.com/v1
DLG_MODEL=deepseek-v4-pro
```

### File `llm.service.js`

```js
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.DLG_API_KEY,
  baseURL: process.env.DLG_BASE_URL || "https://danglamgiau.com/v1",
});

export async function callLLM({
  userMessage,
  systemPrompt = "Bạn là trợ lý AI hữu ích, trả lời chính xác và ngắn gọn.",
  temperature = 0.3,
  maxTokens = 1000,
}) {
  if (!process.env.DLG_API_KEY) {
    throw new Error("Missing DLG_API_KEY in environment variables.");
  }

  const response = await client.chat.completions.create({
    model: process.env.DLG_MODEL || "deepseek-v4-pro",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature,
    max_tokens: maxTokens,
  });

  return response.choices?.[0]?.message?.content ?? "";
}
```

### File `server.js` dùng Express

```bash
npm install express cors
```

```js
import express from "express";
import cors from "cors";
import { callLLM } from "./llm.service.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Field 'message' is required and must be a string.",
      });
    }

    const answer = await callLLM({
      userMessage: message,
      systemPrompt: "Bạn là trợ lý kỹ thuật backend. Trả lời bằng tiếng Việt.",
      temperature: 0.2,
      maxTokens: 1200,
    });

    return res.json({
      answer,
    });
  } catch (error) {
    console.error("LLM API error:", error);

    return res.status(500).json({
      error: "Failed to call LLM API.",
    });
  }
});

app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});
```

### Chạy thử

```bash
node server.js
```

Test:

```bash
curl http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"API backend là gì?"}'
```

---

## 9. Ví dụ gọi API bằng Python backend

### Cài dependencies

```bash
pip install openai python-dotenv fastapi uvicorn
```

### File `.env`

```env
API_key = Insert my API Key here

DLG_API_KEY=Insert my API Key here
DLG_BASE_URL=https://danglamgiau.com/v1
DLG_MODEL=deepseek-v4-pro
```

### File `llm_service.py`

```python
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.getenv("DLG_API_KEY"),
    base_url=os.getenv("DLG_BASE_URL", "https://danglamgiau.com/v1"),
)

def call_llm(
    user_message: str,
    system_prompt: str = "Bạn là trợ lý AI hữu ích, trả lời chính xác và ngắn gọn.",
    temperature: float = 0.3,
    max_tokens: int = 1000,
) -> str:
    if not os.getenv("DLG_API_KEY"):
        raise RuntimeError("Missing DLG_API_KEY in environment variables.")

    response = client.chat.completions.create(
        model=os.getenv("DLG_MODEL", "deepseek-v4-pro"),
        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_message,
            },
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )

    return response.choices[0].message.content or ""
```

### File `main.py` dùng FastAPI

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from llm_service import call_llm

app = FastAPI(title="LLM Backend API")

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
def chat(req: ChatRequest):
    try:
        answer = call_llm(
            user_message=req.message,
            system_prompt="Bạn là trợ lý kỹ thuật backend. Trả lời bằng tiếng Việt.",
            temperature=0.2,
            max_tokens=1200,
        )
        return {"answer": answer}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to call LLM API") from exc
```

### Chạy server

```bash
uvicorn main:app --reload --port 8000
```

Test:

```bash
curl http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Giải thích RAG là gì?"}'
```

---

## 10. Streaming response

Streaming phù hợp với chatbot UI vì backend nhận từng phần nội dung từ model.

### Node.js streaming service

```js
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.DLG_API_KEY,
  baseURL: process.env.DLG_BASE_URL || "https://danglamgiau.com/v1",
});

export async function streamLLM({ userMessage, onToken }) {
  const stream = await client.chat.completions.create({
    model: process.env.DLG_MODEL || "deepseek-v4-pro",
    messages: [
      {
        role: "system",
        content: "Bạn là trợ lý AI hữu ích.",
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature: 0.3,
    stream: true,
  });

  for await (const chunk of stream) {
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) {
      onToken(token);
    }
  }
}
```

### Express endpoint streaming về client

```js
app.post("/api/chat/stream", async (req, res) => {
  try {
    const { message } = req.body;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    await streamLLM({
      userMessage: message,
      onToken: (token) => {
        res.write(token);
      },
    });

    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).end("Streaming failed.");
  }
});
```

---

## 11. Tích hợp vào hệ thống RAG

### Pipeline RAG đề xuất

```text
1. User hỏi
2. Backend nhận query
3. Embed query
4. Search vector database
5. Lấy top-k chunks liên quan
6. Build prompt gồm:
   - system instruction
   - context từ tài liệu
   - câu hỏi user
7. Gọi /v1/chat/completions
8. Trả lời kèm nguồn/chunk/page nếu có
```

### Prompt template cho RAG

```text
Bạn là trợ lý hỏi đáp tài liệu kỹ thuật.

Quy tắc:
- Chỉ trả lời dựa trên CONTEXT được cung cấp.
- Nếu context không đủ, nói rõ là không đủ dữ liệu.
- Không bịa thông tin.
- Trả lời bằng tiếng Việt.
- Nếu có thể, trích dẫn tên tài liệu/trang/chunk.

CONTEXT:
{{retrieved_context}}

CÂU HỎI:
{{user_question}}
```

### Ví dụ build messages cho RAG

```js
const messages = [
  {
    role: "system",
    content: `
Bạn là trợ lý hỏi đáp tài liệu kỹ thuật.
Chỉ sử dụng CONTEXT được cung cấp.
Nếu thiếu thông tin, nói rõ là không đủ dữ liệu.
Trả lời bằng tiếng Việt.
`.trim(),
  },
  {
    role: "user",
    content: `
CONTEXT:
${contextText}

CÂU HỎI:
${userQuestion}
`.trim(),
  },
];
```

### Node.js RAG call

```js
const response = await client.chat.completions.create({
  model: process.env.DLG_MODEL,
  messages,
  temperature: 0.1,
  max_tokens: 1500,
});
```

### Khuyến nghị tham số cho RAG

```json
{
  "temperature": 0.1,
  "max_tokens": 1500
}
```

Vì RAG cần tính chính xác, nên để `temperature` thấp.

---

## 12. Tích hợp cho AI Agent

Nếu dùng API này cho agent, backend nên tách rõ 3 lớp:

```text
Agent Controller
   |
   |-- Planning
   |-- Tool selection
   |-- Tool execution
   |-- Observation
   |-- Final response
```

### Agent không nên được quyền làm mọi thứ

Nên có allowlist tool:

```js
const allowedTools = [
  "search_documents",
  "query_database",
  "summarize_text",
  "create_report",
];
```

Không nên cho agent tự do gọi:

- Shell command.
- File system toàn quyền.
- Database write/delete.
- Gửi email thật.
- Gọi API thanh toán.
- Thao tác admin.

Nếu cần tool nguy hiểm, phải có human approval.

---

## 13. Function calling / tool calling

Tài liệu công khai xác nhận API tương thích kiểu OpenAI cho chat completions. Tuy nhiên, không nên mặc định rằng mọi model/provider đều hỗ trợ `tools` hoặc `tool_choice`.

Nếu muốn dùng tool calling, hãy test thực tế với model đang dùng.

Ví dụ request theo kiểu OpenAI-compatible:

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {
      "role": "user",
      "content": "Tìm thông tin khách hàng mã KH001."
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_customer",
        "description": "Lấy thông tin khách hàng theo mã khách hàng.",
        "parameters": {
          "type": "object",
          "properties": {
            "customer_id": {
              "type": "string"
            }
          },
          "required": ["customer_id"]
        }
      }
    }
  ]
}
```

Nếu API/model trả về `tool_calls`, backend cần:

1. Parse tool call.
2. Kiểm tra tool có nằm trong allowlist không.
3. Validate arguments.
4. Gọi tool thật.
5. Gửi kết quả tool lại model.
6. Lấy final answer.

---

## 14. Error handling cho backend

Backend cần xử lý các nhóm lỗi sau.

### 401 Unauthorized

Nguyên nhân:

- API key sai.
- API key thiếu.
- Header Authorization không đúng format.

Cách kiểm tra:

```http
Authorization: Bearer YOUR_API_KEY
```

Không dùng:

```http
Authorization: YOUR_API_KEY
```

---

### 403 Forbidden

Nguyên nhân có thể:

- API key không có quyền gọi model.
- Bị chặn bởi gateway/WAF.
- Request bị nhận diện là bot không hợp lệ.

Cách xử lý:

- Kiểm tra API key.
- Kiểm tra gói dịch vụ.
- Thử gọi bằng `curl` hoặc Postman.
- Thêm User-Agent rõ ràng nếu client bị chặn.

Ví dụ:

```http
User-Agent: MyBackend/1.0
```

---

### 404 Not Found

Nguyên nhân:

- Sai endpoint.
- Sai base URL.

Đúng:

```text
https://danglamgiau.com/v1/chat/completions
```

Sai thường gặp:

```text
https://danglamgiau.com/chat/completions
https://danglamgiau.com/api/chat/completions
```

---

### 429 Rate Limit

Nguyên nhân:

- Gọi quá nhiều request.
- Vượt quota/tốc độ của gói.
- Hết hạn mức tạm thời.

Cách xử lý:

- Retry với exponential backoff.
- Queue request.
- Cache kết quả.
- Giới hạn request theo user.
- Không để frontend gọi trực tiếp API LLM.

---

### 500 / 502 / 503

Nguyên nhân:

- Lỗi upstream model.
- Gateway lỗi tạm thời.
- Model quá tải.

Cách xử lý:

- Retry có giới hạn.
- Fallback model.
- Trả lỗi thân thiện cho user.
- Log request id nếu có.

---

## 15. Retry và timeout

Không nên gọi API không timeout.

### Node.js với timeout

```js
const client = new OpenAI({
  apiKey: process.env.DLG_API_KEY,
  baseURL: process.env.DLG_BASE_URL,
  timeout: 60_000,
  maxRetries: 2,
});
```

### Exponential backoff tự viết

```js
async function withRetry(fn, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const status = error?.status;
      const retryable = [429, 500, 502, 503, 504].includes(status);

      if (!retryable || attempt === retries) {
        throw error;
      }

      const delayMs = 500 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
```

Dùng:

```js
const answer = await withRetry(() =>
  callLLM({
    userMessage: "Hello",
  })
);
```

---

## 16. Bảo mật API key

### Không bao giờ để API key ở frontend

Sai:

```js
// Browser code
const apiKey = "your_api_key";
```

Nếu API key nằm ở frontend, người dùng có thể mở DevTools và lấy key.

Đúng:

```text
Frontend -> Backend của bạn -> danglamgiau.com API
```

---

### Không commit `.env`

Thêm vào `.gitignore`:

```gitignore
.env
.env.local
.env.production
```

Tạo file mẫu:

```env
# .env.example
DLG_API_KEY=Insert my API Key here
DLG_BASE_URL=https://danglamgiau.com/v1
DLG_MODEL=deepseek-v4-pro
```

---

### Rotate key định kỳ

Nên đổi API key khi:

- Key bị lộ.
- Có thành viên nghỉ dự án.
- Log vô tình chứa key.
- Repository từng public nhầm `.env`.

---

## 17. Logging nên và không nên

### Nên log

```json
{
  "provider": "danglamgiau",
  "model": "deepseek-v4-pro",
  "latency_ms": 2530,
  "status": 200,
  "prompt_tokens": 500,
  "completion_tokens": 200
}
```

### Không nên log

- API key.
- Toàn bộ prompt chứa dữ liệu nhạy cảm.
- Dữ liệu cá nhân.
- File nội bộ chưa được mask.
- Token/session của user.

---

## 18. Rate limit nội bộ

Dù nhà cung cấp có rate limit, backend của bạn vẫn nên tự giới hạn.

Ví dụ:

```bash
npm install express-rate-limit
```

```js
import rateLimit from "express-rate-limit";

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "Too many chat requests. Please try again later.",
  },
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  // handler
});
```

Có thể giới hạn theo:

- User ID.
- IP address.
- API token nội bộ.
- Workspace/project.

---

## 19. Cache response

Với các câu hỏi lặp lại, nên cache để giảm chi phí.

Ví dụ cache key:

```text
hash(model + normalized_question + retrieved_context_ids)
```

Không nên cache nếu:

- Câu hỏi chứa dữ liệu cá nhân.
- Kết quả phụ thuộc thời gian thực.
- Câu hỏi cần trạng thái mới nhất.

---

## 20. Cấu hình model theo môi trường

### Development

```env
DLG_MODEL=deepseek-v4-pro
DLG_TEMPERATURE=0.2
DLG_MAX_TOKENS=1000
```

### Production

```env
DLG_MODEL=deepseek-v4-pro
DLG_TEMPERATURE=0.1
DLG_MAX_TOKENS=1500
```

> Tên model ở đây chỉ là ví dụ theo format thường gặp. Hãy gọi `/v1/models` để xác nhận model thực tế trong tài khoản.

---

## 21. Checklist test API

### Test 1: API key

```bash
curl https://danglamgiau.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Kỳ vọng:

- HTTP 200.
- Có danh sách model.

---

### Test 2: Chat đơn giản

```bash
curl https://danglamgiau.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [
      {
        "role": "user",
        "content": "Say hello in Vietnamese."
      }
    ]
  }'
```

Kỳ vọng:

- HTTP 200.
- Có `choices[0].message.content`.

---

### Test 3: Sai API key

Dùng key giả để kiểm tra backend xử lý lỗi 401.

---

### Test 4: Sai model

Dùng model không tồn tại để kiểm tra lỗi.

---

### Test 5: Timeout

Gửi prompt dài để kiểm tra timeout/retry.

---

### Test 6: Streaming

Gọi với:

```json
"stream": true
```

Kiểm tra backend có nhận token dần không.

---

## 22. Cấu hình cho OpenAI SDK

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_API_KEY",
    base_url="https://danglamgiau.com/v1",
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {
            "role": "user",
            "content": "Hello"
        }
    ],
)

print(response.choices[0].message.content)
```

### Node.js

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DLG_API_KEY,
  baseURL: "https://danglamgiau.com/v1",
});

const response = await client.chat.completions.create({
  model: "deepseek-v4-pro",
  messages: [
    {
      role: "user",
      content: "Hello",
    },
  ],
});

console.log(response.choices[0].message.content);
```

---

## 23. Cấu hình cho Cline/Roo Code/OpenClaw hoặc tool tương tự

Vì API có kiểu OpenAI-compatible, các công cụ coding agent thường có thể cấu hình theo dạng:

```text
Provider: OpenAI-compatible
Base URL: https://danglamgiau.com/v1
API Key: YOUR_API_KEY
Model: model lấy từ /v1/models
```

Nếu tool yêu cầu endpoint cụ thể:

```text
https://danglamgiau.com/v1/chat/completions
```

### Lưu ý về User-Agent/WAF

Nếu một tool gọi API bị lỗi nhưng `curl` hoặc Postman vẫn chạy được, khả năng là request từ tool bị gateway/WAF chặn theo header hoặc User-Agent.

Cách xử lý thường dùng:

- Kiểm tra log lỗi HTTP.
- Thử gọi cùng payload bằng `curl`.
- Thêm `User-Agent` rõ ràng nếu tool cho phép.
- Dùng backend proxy của bạn đứng giữa tool và API.
- Không để tool gọi trực tiếp nếu cần kiểm soát bảo mật/quota.

---

## 24. Backend proxy cho tool/agent

Bạn có thể tạo một endpoint nội bộ:

```text
POST /internal/llm/chat
```

Backend sẽ:

1. Nhận request từ tool/agent.
2. Kiểm tra auth nội bộ.
3. Thêm API key thật ở server.
4. Gọi `danglamgiau.com`.
5. Trả response về tool.

Lợi ích:

- Không lộ API key cho tool/client.
- Có thể log chi phí.
- Có thể rate limit theo user.
- Có thể đổi provider/model mà không sửa tool.
- Có thể thêm fallback model.

---

## 25. Mẫu service production-oriented cho Node.js

```js
import OpenAI from "openai";

export class LLMService {
  constructor({
    apiKey,
    baseURL = "https://danglamgiau.com/v1",
    model = "deepseek-v4-pro",
  }) {
    if (!apiKey) {
      throw new Error("LLM API key is required.");
    }

    this.model = model;

    this.client = new OpenAI({
      apiKey,
      baseURL,
      timeout: 60_000,
      maxRetries: 2,
    });
  }

  async chat({
    systemPrompt,
    userMessage,
    temperature = 0.2,
    maxTokens = 1200,
  }) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    return {
      text: response.choices?.[0]?.message?.content ?? "",
      usage: response.usage ?? null,
      raw: response,
    };
  }
}
```

Sử dụng:

```js
const llm = new LLMService({
  apiKey: process.env.DLG_API_KEY,
  baseURL: process.env.DLG_BASE_URL,
  model: process.env.DLG_MODEL,
});

const result = await llm.chat({
  systemPrompt: "Bạn là trợ lý kỹ thuật.",
  userMessage: "Giải thích OAuth2.",
});

console.log(result.text);
```

---

## 26. Mẫu service production-oriented cho Python

```python
import os
from dataclasses import dataclass
from typing import Optional

from openai import OpenAI


@dataclass
class LLMResult:
    text: str
    usage: Optional[dict]


class LLMService:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://danglamgiau.com/v1",
        model: str = "deepseek-v4-pro",
    ):
        if not api_key:
            raise ValueError("LLM API key is required.")

        self.model = model
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=60.0,
            max_retries=2,
        )

    def chat(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.2,
        max_tokens: int = 1200,
    ) -> LLMResult:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": user_message,
                },
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        return LLMResult(
            text=response.choices[0].message.content or "",
            usage=response.usage.model_dump() if response.usage else None,
        )


llm = LLMService(
    api_key=os.getenv("DLG_API_KEY"),
    base_url=os.getenv("DLG_BASE_URL", "https://danglamgiau.com/v1"),
    model=os.getenv("DLG_MODEL", "deepseek-v4-pro"),
)
```

---

## 27. Prompt engineering cho backend

### System prompt nên ngắn, rõ, có quy tắc

Ví dụ cho chatbot kỹ thuật:

```text
Bạn là trợ lý kỹ thuật cho hệ thống backend.
Yêu cầu:
- Trả lời bằng tiếng Việt.
- Ưu tiên tính chính xác.
- Nếu thiếu dữ liệu, nói rõ là chưa đủ thông tin.
- Không bịa đặt.
- Với câu hỏi kỹ thuật, đưa ví dụ code ngắn nếu cần.
```

### Với RAG

```text
Bạn là trợ lý hỏi đáp tài liệu.
Chỉ được dùng thông tin trong CONTEXT.
Nếu CONTEXT không đủ, trả lời: "Tài liệu hiện có chưa đủ để kết luận."
Không suy đoán ngoài tài liệu.
```

### Với trích xuất dữ liệu JSON

```text
Bạn là bộ trích xuất dữ liệu.
Chỉ trả về JSON hợp lệ.
Không thêm giải thích ngoài JSON.
Nếu trường nào không có dữ liệu, trả về null.
```

---

## 28. Bắt buộc validate output nếu dùng cho nghiệp vụ

Không nên tin output LLM 100%.

Ví dụ nếu yêu cầu trả JSON, cần parse:

```js
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }
}
```

Với dữ liệu quan trọng:

- Validate schema.
- Check null/missing field.
- Không tự động ghi database nếu chưa xác minh.
- Không tự động gửi email/thanh toán/xóa dữ liệu.

---

## 29. Chi phí và quota

Trang dịch vụ có các gói như Lite/Pro/Pro Plus và cơ chế reset hạn mức theo thời gian. Khi tích hợp backend, nên thiết kế để không phụ thuộc cứng vào một quota cụ thể vì hạn mức có thể thay đổi theo gói.

Backend nên có:

- Rate limit nội bộ.
- Queue cho tác vụ batch.
- Cache.
- Monitoring token usage.
- Cảnh báo khi gần hết quota.
- Fallback khi model/provider lỗi.

---

## 30. Monitoring cần có

Nên theo dõi:

| Metric | Ý nghĩa |
|---|---|
| `request_count` | Tổng số request gọi LLM |
| `success_rate` | Tỷ lệ gọi thành công |
| `error_rate` | Tỷ lệ lỗi |
| `latency_p50/p95/p99` | Độ trễ |
| `prompt_tokens` | Token đầu vào |
| `completion_tokens` | Token đầu ra |
| `total_tokens` | Tổng token |
| `cost_estimate` | Ước tính chi phí nếu có đơn giá |
| `rate_limit_count` | Số lần bị 429 |
| `timeout_count` | Số lần timeout |

---

## 31. Các lỗi tích hợp thường gặp

### Lỗi 1: Dùng sai `baseURL`

Sai:

```js
baseURL: "https://danglamgiau.com/v1/chat/completions"
```

Đúng khi dùng SDK:

```js
baseURL: "https://danglamgiau.com/v1"
```

Vì SDK sẽ tự thêm `/chat/completions`.

---

### Lỗi 2: Thiếu Bearer

Sai:

```http
Authorization: YOUR_API_KEY
```

Đúng:

```http
Authorization: Bearer YOUR_API_KEY
```

---

### Lỗi 3: Gọi API từ frontend

Không nên:

```text
Browser -> danglamgiau.com API
```

Nên:

```text
Browser -> Your Backend -> danglamgiau.com API
```

---

### Lỗi 4: Không kiểm soát prompt dài

Nếu đưa quá nhiều context vào prompt:

- Dễ vượt context limit.
- Tăng chi phí.
- Tăng latency.
- Có thể làm câu trả lời kém chính xác.

RAG nên rerank và chỉ đưa context liên quan nhất.

---

### Lỗi 5: Không có fallback

Nên có phương án:

```text
Primary model lỗi -> thử model phụ -> trả thông báo thân thiện
```

---

## 32. Mẫu `.env.example` hoàn chỉnh

```env
# Required
API_key = Insert my API Key here
DLG_API_KEY=Insert my API Key here

# Provider config
DLG_BASE_URL=https://danglamgiau.com/v1
DLG_MODEL=deepseek-v4-pro

# Generation config
DLG_TEMPERATURE=0.2
DLG_MAX_TOKENS=1500

# Backend controls
LLM_TIMEOUT_MS=60000
LLM_MAX_RETRIES=2
LLM_RATE_LIMIT_PER_MINUTE=20
```

---

## 33. Mẫu cấu trúc thư mục backend

```text
backend/
  src/
    config/
      env.js
    services/
      llm.service.js
      rag.service.js
    routes/
      chat.route.js
    middlewares/
      rateLimit.js
      auth.js
    utils/
      logger.js
      retry.js
  .env
  .env.example
  package.json
```

---

## 34. Checklist triển khai production

- [ ] API key nằm trong biến môi trường.
- [ ] Không commit `.env`.
- [ ] Backend không expose API key ra frontend.
- [ ] Có timeout.
- [ ] Có retry giới hạn.
- [ ] Có rate limit nội bộ.
- [ ] Có logging nhưng không log secret.
- [ ] Có monitoring latency/error/token.
- [ ] Có fallback model/provider nếu cần.
- [ ] Có validate input từ user.
- [ ] Có validate output nếu dùng cho nghiệp vụ.
- [ ] Với RAG: có kiểm soát context, top-k, rerank.
- [ ] Với agent: có allowlist tool và human approval cho hành động nhạy cảm.
- [ ] Có test `/v1/models` trước khi hardcode model.
- [ ] Có test streaming nếu UI cần realtime.

---

## 35. Kết luận

Để tích hợp API `danglamgiau.com` vào backend, cách sạch nhất là coi nó như một **OpenAI-compatible provider**:

```text
base_url = https://danglamgiau.com/v1
auth     = Authorization: Bearer YOUR_API_KEY
endpoint = /chat/completions
model    = lấy từ /v1/models
```

Với dự án backend nghiêm túc, không nên chỉ viết một đoạn `curl` rồi gọi trực tiếp. Nên tạo `LLMService` riêng để kiểm soát:

- Bảo mật API key.
- Retry.
- Timeout.
- Rate limit.
- Logging.
- Streaming.
- RAG context.
- Agent tool execution.
- Fallback model/provider.

Cách này giúp hệ thống dễ bảo trì, dễ đổi model, giảm rủi ro lộ key và phù hợp hơn khi đưa vào production.
