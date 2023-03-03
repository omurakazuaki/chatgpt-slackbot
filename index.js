const { App } = require('@slack/bolt');
const app = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN
});

const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const { encode } = require('gpt-3-encoder');

const COMPLETIONS_MODEL = "gpt-3.5-turbo"
const CHAT_GPT_SYSTEM_PROMPT = `
You are an excellent AI assistant Slack Bot.
Please output your response message according to following format.

- bold: "*bold*"
- italic: "_italic_"
- strikethrough: "~strikethrough~"
- code: " \`code\` "
- link: "<https://slack.com|link text>"
- block: "\`\`\` code block \`\`\`"
- bulleted list: "* item1"

Be sure to include a space before and after the single quote in the sentence.
ex) word\`code\`word -> word \`code\` word

Let's begin.
`
const MAX_TOKEN = 4096;

const createCompletion = async(messages, model = COMPLETIONS_MODEL) => {
  try {
    let length = 0;
    let filteredMessages = [];
    for (const msg of messages.reverse()) {
      length += encode(msg.content).length;
      if (length >= MAX_TOKEN) break;
      filteredMessages = [msg, ...filteredMessages];
    }
    console.debug(JSON.stringify(filteredMessages), length)

    return await openai.createChatCompletion({
      temperature: 0.5,
      model,
      messages: [
        {role: 'system', content: CHAT_GPT_SYSTEM_PROMPT},
        ...filteredMessages
      ],
      stop: [" END", " ->"],
    });
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

const postMessage = async ({
  client,
  channel,
  ts,
  thread_ts,
  text,
}) => {
  return await client.chat.postMessage({
    channel,
    thread_ts: thread_ts || ts,
    icon_emoji: ":robot_face:",
    username: 'SlackGPT',
    text,
  });
}

app.event('message', async ({ event, client }) => {
  const { channel, ts, thread_ts, channel_type } = event
  const threadMessagesResponse = await client.conversations.replies({
    channel,
    ts: thread_ts || ts,
  });
  const messages = threadMessagesResponse.messages?.sort((a, b) => Number(a.ts) - Number(b.ts));
  const { user_id: bot_user_id } = await client.auth.test();
  if (channel_type !== 'im' && (!messages.length || !messages[0].text.includes(`@${bot_user_id}`))) {
    return;
  }
  const gptmessages = messages.map(m => ({ role: m.user === bot_user_id ? 'assistant': 'user', content: m.text}));
  const response = await createCompletion(gptmessages);
  const botRes = response?.data?.choices[0]?.message?.content || '申し訳ございません。エラーが発生しました。別のスレッドで試してみてください';
  await postMessage({ client, channel, ts, thread_ts, text: botRes } );
});

// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();

