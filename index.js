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

const fs = require("fs");
const readSettings = () => {
  return JSON.parse(fs.readFileSync('settings.json'));
}
const storeSettings = (settings) => {
  fs.writeFileSync('settings.json', JSON.stringify(settings));
}

const COMPLETIONS_MODEL = "gpt-3.5-turbo"
const DEFAULT_CHAT_GPT_SYSTEM_PROMPT = `You are an excellent AI assistant Slack Bot.
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

const CHAT_GPT_SYSTEM_PROMPTS = {
default: DEFAULT_CHAT_GPT_SYSTEM_PROMPT,
normal: DEFAULT_CHAT_GPT_SYSTEM_PROMPT,
englishteacher:`Role play a very smart and kind English teacher.
* First, evaluate the user's message in terms of spelling, phrasing and grammar, and raise any points that are not good.
* Secondly, Proofread and provide user messages in clearer, more elegant English.
* Finally, describe your reply to the user's message.
* When explaining grammar and phrases, provide examples as well.
* The output format is as follows.

#Output format:

*Evaluate and Improvement*
your evaluate and improvement.

*Proofread*
User's messages you have proofread.

*Reply*
Your reply to the user's message.

Let's begin.
`}

const MAX_TOKEN = 4096;

const createCompletion = async(allMessages, role = 'default', model = COMPLETIONS_MODEL) => {
  try {
    const system_prompt = CHAT_GPT_SYSTEM_PROMPTS[role];
    let length = encode(system_prompt).length;
    let messages = [];
    for (const msg of allMessages.reverse()) {
      length += encode(msg.content).length;
      if (length >= MAX_TOKEN) break;
      messages = [msg, ...messages];
    }
    messages = [{role: 'system', content: system_prompt}, ...messages];
    console.debug(JSON.stringify(messages), length)

    return await openai.createChatCompletion({
      temperature: 0.5,
      model,
      messages,
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
  const { channel, ts, thread_ts, channel_type, user: user_id } = event
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
  const settings = readSettings();
  const role = settings.roleplay[user_id];
  console.debug(user_id, role);
  const response = await createCompletion(gptmessages, role);
  const botRes = response?.data?.choices[0]?.message?.content || '申し訳ございません。エラーが発生しました。別のスレッドで試してみてください';
  await postMessage({ client, channel, ts, thread_ts, text: botRes } );
});

app.command('/roleplay', async ({ command, ack, say }) => {
  const settings = readSettings();
  const { text, user_id } = command;
  await ack();
  if (!text || !text.length) {
    await say(`My current roll is *${settings.roleplay[user_id] ?? 'default'}*.`);
    return;
  }
  const role = text.toLowerCase().replace(/[ -_"'`]/g, '');
  if (!CHAT_GPT_SYSTEM_PROMPTS[role]) {
    await say(`Role *${role}* does not exist.
You can choose from the following options:
${Object.keys(CHAT_GPT_SYSTEM_PROMPTS).map(v => `* ${v}`).join('\n')}`);
    return;
  }
  settings.roleplay[user_id] = role;
  storeSettings(settings);
  await say(`I have set my role to *${role}*.`);
});

// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
