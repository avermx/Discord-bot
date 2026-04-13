const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
require("dotenv").config();

/* ================= CONFIG ================= */
// ⚠️ APNA TOKEN YAHAN PASTE KAREIN
const TOKEN = process.env.TOKEN;

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PREFIX = ".";

const ADMIN_ROLE_ID = "1460621961398059246";
const MOD_ROLE_ID = "1460621952363532339";
const LOG_CHANNEL_ID = "1379081690390986833";
const VCHELP_CHANNEL_ID = "1462380312435757263"; // Set this
const VCHELP_ROLE_ID = "1462797625081204736"; // Set this
const BYPASS_ROLE_ID = "1464298301552591019"; // Set this - Users with this role cannot be moderated

/* ===== MUTE CHANCES ===== */
const MAX_MUTES_PER_USER = 5;
const MUTE_RESET_TIME = 24 * 60 * 60 * 1000;

/* ===== WARN SYSTEM ===== */
const userWarnings = new Map(); // Format: userId -> [{reason, date, warnedBy, id}, ...]
let warnIdCounter = 1;

/* ===== MUTE TRACKING SYSTEM ===== */
const userMuteData = new Map(); // Format: userId -> { used: number, resetAt: number }
const mutedByTracker = new Map(); // Format: userId -> {mutedBy: modId, timestamp: Date.now()}

/* ===== DEBOUNCE MAP ===== */
const recentActions = new Map();

/* ===== DEBOUNCE FUNCTION ===== */
const debounceAction = (key, callback, delay = 2000) => {
  if (recentActions.has(key)) return;
  recentActions.set(key, true);
  callback();
  setTimeout(() => recentActions.delete(key), delay);
};

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

/* ================= UTILS ================= */
const hasRole = (member, roles = []) =>
  member && roles.some((r) => member.roles.cache.has(r));

const hasBypassRole = (member) => {
  const hasRole = member && member.roles.cache.has(BYPASS_ROLE_ID);
  console.log(`Bypass check - User: ${member?.user?.username}, BypassRoleID: ${BYPASS_ROLE_ID}, HasBypassRole: ${hasRole}`);
  if (member) {
    console.log(`User roles: ${Array.from(member.roles.cache.keys()).join(', ')}`);
  }
  return hasRole;
};

const canUseCommand = (member, requiredRoles = []) => {
  const hasbypass = hasBypassRole(member);
  const hasrequired = hasRole(member, requiredRoles);
  console.log(`Permission check - User: ${member?.user?.username}, HasBypass: ${hasbypass}, HasRequired: ${hasrequired}, RequiredRoles: ${requiredRoles}`);
  return hasbypass || hasrequired;
};

const safeReply = async (i, msg, eph = false) => {
  try {
    if (i.deferred || i.replied) return await i.editReply(msg);
    return await i.reply({
      content: msg,
      flags: eph ? MessageFlags.Ephemeral : undefined,
    });
  } catch {}
};

/* ================= SLASH COMMANDS ================= */
const slashCommands = [
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Target user").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Target user").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute a user in voice")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.MuteMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Target user").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.MoveMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Target user").setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Target voice channel")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("moveall")
    .setDescription("Move everyone")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.MoveMembers)
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Target voice channel")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a user with reason")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("User to warn").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("scan")
    .setDescription("Check warning history of a user")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to scan").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Clear all warnings of a user")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription("User whose warnings to clear").setRequired(true)
    ),
].map((c) => c.toJSON());

/* ================= READY ================= */
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: slashCommands,
    });
    console.log("✅ Slash commands registered");
  } catch (error) {
    console.error("Slash commands register error:", error);
  }
});

/* ================= VOICE STATE UPDATE (DEBOUNCED) ================= */
client.on("voiceStateUpdate", async (oldState, newState) => {
  const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
  if (!logChannel) return;

  const member = newState.member;
  
  if (member.user.bot) return;

  if (oldState.channel?.id !== newState.channel?.id) {
    if (oldState.channel && newState.channel) {
      const key = `${member.id}-move-${oldState.channel.id}-${newState.channel.id}`;
      debounceAction(key, () => {
        logChannel.send(
          `🔀 ${member.user.tag} ko **${oldState.channel.name}** se **${newState.channel.name}** move kiya gaya!`
        );
      });
    } else if (newState.channel && !oldState.channel) {
      const key = `${member.id}-join-${newState.channel.id}`;
      debounceAction(key, () => {
        logChannel.send(
          `🔊 ${member.user.tag} **${newState.channel.name}** join kiya!`
        );
      });
    } else if (oldState.channel && !newState.channel) {
      const key = `${member.id}-leave-${oldState.channel.id}`;
      debounceAction(key, () => {
        logChannel.send(
          `🔇 ${member.user.tag} **${oldState.channel.name}** se disconnect hua!`
        );
      });
    }
    return;
  }

  if (oldState.serverMute !== newState.serverMute) {
    const key = `${member.id}-mute-${newState.serverMute}`;
    debounceAction(key, () => {
      if (newState.serverMute) {
        logChannel.send(
          `🔇 ${member.user.tag} ko **server mute** kar diya gaya!`
        );
      } else {
        logChannel.send(
          `🔊 ${member.user.tag} ko **server unmute** kar diya gaya!`
        );
      }
    });
    return;
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    const key = `${member.id}-deaf-${newState.serverDeaf}`;
    debounceAction(key, () => {
      if (newState.serverDeaf) {
        logChannel.send(
          `🔇 ${member.user.tag} ko **server deafen** kar diya gaya!`
        );
      } else {
        logChannel.send(
          `🔊 ${member.user.tag} ko **undeafen** kar diya gaya!`
        );
      }
    });
  }
});

/* ================= PREFIX COMMANDS ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  try {
    /* ===== VCREQ - Request to Join Someone's VC ===== */
    if (cmd === "vcreq" || cmd === "vcr") {
      const target = message.mentions.members.first();
      
      if (!target) {
        return message.reply("❌ Kisi user ko mention karo jiske VC mein jaana hai!");
      }

      if (target.id === message.author.id) {
        return message.reply("❌ Apne aap ko request nahi bhej sakte!");
      }

      if (!target.voice.channel) {
        return message.reply("❌ Wo user kisi voice channel mein nahi hai!");
      }

      if (!message.member.voice.channel) {
        return message.reply("❌ Pehle aapko kisi voice channel mein hona zaroori hai!");
      }

      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setDescription(`🔔 | <@${target.id}>, ${message.author.username} wants to join your voice channel.\nClick **Allow** to pull them in.`);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vcreq_accept_${message.author.id}_${target.id}`)
          .setLabel("Allow")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`vcreq_deny_${message.author.id}_${target.id}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger)
      );

      await message.channel.send({
        embeds: [embed],
        components: [buttons],
        allowedMentions: { users: [target.id] }
      });

      return;
    }

    /* ===== VCINV - Invite Someone to Your VC ===== */
    if (cmd === "vcinv" || cmd === "vci") {
      const target = message.mentions.members.first();
      
      if (!target) {
        return message.reply("❌ Kisi user ko mention karo jise invite karna hai!");
      }

      if (target.id === message.author.id) {
        return message.reply("❌ Apne aap ko invite nahi kar sakte!");
      }

      if (!message.member.voice.channel) {
        return message.reply("❌ Pehle aap kisi voice channel mein ho tabhi invite bhej sakte ho!");
      }

      const embed = new EmbedBuilder()
        .setColor("#9b59b6")
        .setTitle("📨 Voice Channel Invitation")
        .setDescription(`${message.author} invites you to join their voice channel!`)
        .addFields(
          { name: "👤 Invited by:", value: message.author.toString(), inline: true },
          { name: "🔊 Channel:", value: message.member.voice.channel.toString(), inline: true }
        )
        .setFooter({ text: `Invitation from ${message.author.username}` })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vcinv_join_${message.author.id}_${target.id}`)
          .setLabel("Join")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🔗"),
        new ButtonBuilder()
          .setCustomId(`vcinv_deny_${message.author.id}_${target.id}`)
          .setLabel("Decline")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌")
      );

      await message.channel.send({
        content: `${target}`,
        embeds: [embed],
        components: [buttons]
      });

      try {
        await message.delete();
      } catch (e) {
        console.log("Cannot delete message");
      }

      return;
    }

    /* ===== VCHELP COMMAND ===== */
    if (cmd === "vchelp" || cmd === "vc") {
      if (message.channel.id !== VCHELP_CHANNEL_ID) {
        const reply = await message.reply(
          `❌ Aap sirf <#${VCHELP_CHANNEL_ID}> mein .vchelp use kar sakte ho!`
        );
        
        setTimeout(() => {
          reply.delete().catch(() => {});
          message.delete().catch(() => {});
        }, 5000);
        
        return;
      }

      if (!message.member?.voice?.channel) {
        const reply = await message.reply(
          "❌ Pehle aapko voice channel mein hona zaroori hai!"
        );
        
        setTimeout(() => {
          reply.delete().catch(() => {});
          message.delete().catch(() => {});
        }, 5000);
        
        return;
      }

      const voiceChannel = message.member.voice.channel;
      const userMessage = args.join(' ') || '*No additional message*';
      
      const embed = new EmbedBuilder()
        .setColor("#FFD700")
        .setTitle("⚠️ | Voice Help Request")
        .addFields(
          { 
            name: "👤 User:", 
            value: message.author.toString(), 
            inline: false 
          },
          { 
            name: "🔊 Voice Channel:", 
            value: voiceChannel.toString(), 
            inline: false 
          },
          { 
            name: "📝 Message:", 
            value: userMessage, 
            inline: false 
          }
        )
        .setFooter({ text: `Requested by ${message.author.username}` })
        .setTimestamp();

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Join Voice Channel")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${message.guild.id}/${voiceChannel.id}`)
          .setEmoji("🔗")
      );

      await message.channel.send({ 
        content: `<@&${VCHELP_ROLE_ID}> - Voice help needed!`,
        embeds: [embed], 
        components: [button] 
      });
      
      try {
        await message.delete();
      } catch (e) {
        console.log("Cannot delete message");
      }
      
      return;
    }

    /* ===== SCAN (PREFIX VERSION) ===== */
    if (cmd === "scan" || cmd === "s") {
      const target = message.mentions.users.first();
      
      if (!target) {
        return message.reply("❌ Kisi user ko mention karo!");
      }

      const warnings = userWarnings.get(target.id) || [];

      if (warnings.length === 0) {
        return message.reply(`✅ **${target.username}** ko koi warning nahi hai!`);
      }

      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle(`⚠️ Warning History - ${target.username}`)
        .setDescription(`Total Warnings: **${warnings.length}**`)
        .setThumbnail(target.displayAvatarURL())
        .setTimestamp();

      const recentWarnings = warnings.slice(-5).reverse();
      
      recentWarnings.forEach((warn) => {
        const date = new Date(warn.date).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          dateStyle: 'short',
          timeStyle: 'short'
        });
        
        embed.addFields({
          name: `Warning #${warn.id}`,
          value: `**Reason:** ${warn.reason}\n**By:** <@${warn.warnedBy}>\n**Date:** ${date}`,
          inline: false
        });
      });

      if (warnings.length > 5) {
        embed.setFooter({ text: `Showing last 5 of ${warnings.length} warnings. Use /scan for full history.` });
      }

      return message.reply({ embeds: [embed] });
    }

    /* ===== KICK ===== */
    if (cmd === "kick" || cmd === "k") {
      if (!canUseCommand(message.member, [ADMIN_ROLE_ID])) return message.reply("❌ Admin only");
      const t = message.mentions.members.first();
      if (!t?.kickable) return message.reply("❌ Cannot kick");
      if (hasBypassRole(t)) return message.reply("❌ Cannot kick - User has bypass role");
      await t.kick();
      return message.reply(`👢 ${t.user.tag} kicked`);
    }

    /* ===== BAN ===== */
    if (cmd === "ban" || cmd === "b") {
      if (!canUseCommand(message.member, [ADMIN_ROLE_ID])) return message.reply("❌ Admin only");
      const t = message.mentions.members.first();
      if (!t?.bannable) return message.reply("❌ Cannot ban");
      if (hasBypassRole(t)) return message.reply("❌ Cannot ban - User has bypass role");
      await t.ban();
      return message.reply(`🔨 ${t.user.tag} banned`);
    }

    /* ===== MUTE ===== */
    if (cmd === "mute" || cmd === "m") {
      if (!canUseCommand(message.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) return message.reply("❌ Mod only");
      
      const t = message.mentions.members.first();
      if (!t?.voice.channel) return message.reply("❌ User voice me nahi hai");
      if (hasBypassRole(t)) return message.reply("❌ Cannot mute - User has bypass role");

      const now = Date.now();
      let data = userMuteData.get(message.author.id) || { used: 0, resetAt: now + MUTE_RESET_TIME };

      if (now >= data.resetAt) {
        data.used = 0;
        data.resetAt = now + MUTE_RESET_TIME;
      }

      if (data.used >= MAX_MUTES_PER_USER) return message.reply("❌ Tumhare mute chances khatam ho gaye");

      await t.voice.setMute(true);
      data.used++;
      userMuteData.set(message.author.id, data);

      // Track who muted this user
      mutedByTracker.set(t.id, {
        mutedBy: message.author.id,
        timestamp: Date.now()
      });

      return message.reply(`🔇 Muted — **${MAX_MUTES_PER_USER - data.used} left**`);
    }

    /* ===== UNMUTE ===== */
    if (cmd === "unmute" || cmd === "um") {
      if (!canUseCommand(message.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) return message.reply("❌ Mod only");
      const t = message.mentions.members.first();
      if (!t?.voice.channel) return message.reply("❌ User voice me nahi hai");
      
      // Check if user was muted by someone else
      const muteInfo = mutedByTracker.get(t.id);
      if (muteInfo) {
        const isOriginalMuter = muteInfo.mutedBy === message.author.id;
        const isAdmin = hasRole(message.member, [ADMIN_ROLE_ID]);
        const isBypassUser = hasBypassRole(message.member);
        
        if (!isOriginalMuter && !isAdmin && !isBypassUser) {
          const originalMuter = await message.guild.members.fetch(muteInfo.mutedBy).catch(() => null);
          const muterName = originalMuter ? originalMuter.user.username : "Unknown";
          return message.reply(`❌ Sirf **${muterName}** ya Admin hi is user ko unmute kar sakta hai!`);
        }
      }
      
      await t.voice.setMute(false);
      
      // Remove from mute tracker
      mutedByTracker.delete(t.id);
      
      return message.reply(`🔊 ${t.user.tag} unmuted`);
    }

    /* ===== CLEAR ===== */
    if (["clear", "purge", "delete", "c", "p"].includes(cmd)) {
      if (!canUseCommand(message.member, [ADMIN_ROLE_ID])) return message.reply("❌ Admin only");
      const amount = parseInt(args[0]);
      if (!amount || amount < 1 || amount > 100) return message.reply("❌ 1 se 100 ke beech number do");
      try {
        const deleted = await message.channel.bulkDelete(amount + 1, true);
        const reply = await message.channel.send(`🗑️ **${deleted.size - 1}** messages deleted`);
        setTimeout(() => reply.delete().catch(() => {}), 3000);
      } catch (e) {
        return message.reply("❌ 14 din se purane messages delete nahi ho sakte");
      }
    }

    /* ===== MOVE ===== */
    if (["move", "mv", "drag"].includes(cmd)) {
      if (!canUseCommand(message.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) return message.reply("❌ Mod only");
      const ch = message.guild.channels.cache.get(args[args.length - 1]);
      if (!ch || ch.type !== ChannelType.GuildVoice) return message.reply("❌ Voice channel ID galat");
      let count = 0;
      for (const m of message.mentions.members.values()) {
        if (!m.voice.channel) continue;
        await m.voice.setChannel(ch);
        count++;
      }
      return message.reply(`🎧 ${count} user(s) dragged`);
    }

    /* ===== MOVE ALL ===== */
    if (["moveall", "mvall", "dragall"].includes(cmd)) {
      if (!canUseCommand(message.member, [ADMIN_ROLE_ID])) return message.reply("❌ Admin only");
      const ch = message.guild.channels.cache.get(args[0]);
      if (!ch || ch.type !== ChannelType.GuildVoice) return message.reply("❌ Voice channel ID galat");
      let count = 0;
      for (const vc of message.guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildVoice)
        .values()) {
        for (const m of vc.members.values()) {
          await m.voice.setChannel(ch);
          count++;
        }
      }
      return message.reply(`🎧 ${count} users moved`);
    }

    /* ===== WARN (PREFIX VERSION) ===== */
    if (cmd === "warn" || cmd === "w") {
      if (!canUseCommand(message.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) {
        return message.reply("❌ Mod/Admin only");
      }

      const target = message.mentions.members.first();
      
      if (!target) {
        return message.reply("❌ Kisi user ko mention karo!");
      }

      if (target.id === message.author.id) {
        return message.reply("❌ Apne aap ko warn nahi kar sakte!");
      }

      if (target.user.bot) {
        return message.reply("❌ Bots ko warn nahi kar sakte!");
      }

      if (hasBypassRole(target)) {
        return message.reply("❌ Cannot warn - User has bypass role");
      }

      // Modal (box) create karein
      const modal = new ModalBuilder()
        .setCustomId(`warn_modal_${target.id}`)
        .setTitle(`⚠️ Warn ${target.user.username}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId("warn_reason")
        .setLabel("Warn Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Warn ka reason yahan likho...")
        .setRequired(true)
        .setMaxLength(500);

      const row = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(row);

      // Create a fake interaction to show modal
      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setDescription(`🔔 | <@${message.author.id}>, click **Open Warn Box** to warn ${target.user.username}.`);

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`warn_button_${target.id}_${message.author.id}`)
          .setLabel("Open Warn Box")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("⚠️")
      );

      await message.channel.send({
        embeds: [embed],
        components: [button],
        allowedMentions: { users: [message.author.id] }
      });

      try {
        await message.delete();
      } catch (e) {
        console.log("Cannot delete message");
      }

      return;
    }

    /* ===== VVC - Voice to Voice Channel ===== */
    if (cmd === "vvc") {
      if (!canUseCommand(message.member, [ADMIN_ROLE_ID])) {
        return message.reply("❌ Admin only");
      }

      const specificChannelId = "1463963206996459623"; // Specific voice channel
      
      if (message.mentions.members.size === 0) {
        return message.reply("❌ Kisi user ko mention karo!\n**Usage:** `.vvc @user1 @user2 @user3...`");
      }

      const targetChannel = message.guild.channels.cache.get(specificChannelId);
      
      if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
        return message.reply("❌ Target voice channel nahi mila!");
      }

      let movedCount = 0;
      let notInVoiceCount = 0;
      let errorCount = 0;
      const movedUsers = [];

      // Move all mentioned users
      for (const [userId, member] of message.mentions.members) {
        try {
          if (!member.voice.channel) {
            notInVoiceCount++;
            continue;
          }

          await member.voice.setChannel(targetChannel);
          movedCount++;
          movedUsers.push(member.user.username);
        } catch (e) {
          console.error(`VVC Error for ${member.user.username}:`, e);
          errorCount++;
        }
      }

      // Create result message
      let resultMessage = "";
      
      if (movedCount > 0) {
        resultMessage += `✅ **${movedCount}** user(s) moved to **${targetChannel.name}**`;
        if (movedUsers.length <= 5) {
          resultMessage += `\n👥 Moved: ${movedUsers.join(", ")}`;
        }
      }
      
      if (notInVoiceCount > 0) {
        resultMessage += `\n⚠️ **${notInVoiceCount}** user(s) not in voice channel`;
      }
      
      if (errorCount > 0) {
        resultMessage += `\n❌ **${errorCount}** user(s) failed to move`;
      }

      const embed = new EmbedBuilder()
        .setColor(movedCount > 0 ? "#00ff00" : "#ff9900")
        .setDescription(resultMessage)
        .setTimestamp();

      const reply = await message.reply({ embeds: [embed] });

      // Delete message after 2 seconds
      setTimeout(() => {
        reply.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 2000);

      return;
    }

    /* ===== HELP COMMAND ===== */
    if (cmd === "help" || cmd === "h") {
      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("Shanks Support Panel™")
        .setDescription("Choose a category from the dropdown below to see its commands.")
        .addFields(
          { name: "Categories:", value: "⚔️ | Moderation\n🔊 | Voice\n🎮 | Gaming VC\n🎫 | Ticket Support\n🔮 | Other", inline: false }
        )
        .setFooter({ text: "Shanks Support" })
        .setThumbnail("https://cdn.discordapp.com/attachments/1234567890/nxt-logo.gif") // Replace with actual GIF URL
        .setTimestamp();

      const selectMenu = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("help_category_select")
          .setPlaceholder("Select a category")
          .addOptions([
            {
              label: "Home",
              description: "Go back to the main help menu.",
              value: "home",
              emoji: "🏠"
            },
            {
              label: "Moderation Commands",
              description: "View moderation commands",
              value: "moderation",
              emoji: "⚔️"
            },
            {
              label: "Voice Commands", 
              description: "View voice commands",
              value: "voice",
              emoji: "🔊"
            },
            {
              label: "Gaming VC Commands",
              description: "View gaming VC commands", 
              value: "gaming",
              emoji: "🎮"
            },
            {
              label: "Ticket Support",
              description: "View ticket support commands",
              value: "ticket",
              emoji: "🎫"
            },
            {
              label: "Other",
              description: "View other commands",
              value: "other",
              emoji: "🔮"
            }
          ])
      );

      await message.channel.send({
        embeds: [embed],
        components: [selectMenu]
      });

      try {
        await message.delete();
      } catch (e) {
        console.log("Cannot delete message");
      }

      return;
    }

  } catch (e) {
    console.error(e);
    message.reply("❌ Error executing command");
  }
});

/* ================= INTERACTION HANDLER (Slash & Buttons & Modals) ================= */
client.on("interactionCreate", async (i) => {
  
  try {
    /* ================= MODAL SUBMIT HANDLING ================= */
    if (i.isModalSubmit()) {
      if (i.customId.startsWith("warn_modal_")) {
        const targetId = i.customId.split("_")[2];
        const reason = i.fields.getTextInputValue("warn_reason");

        const targetUser = await i.guild.members.fetch(targetId).catch(() => null);
        
        if (!targetUser) {
          return i.reply({ content: "❌ User nahi mila", ephemeral: true });
        }

        // Warning save karein
        if (!userWarnings.has(targetId)) {
          userWarnings.set(targetId, []);
        }

        const warnData = {
          id: warnIdCounter++,
          reason: reason,
          date: Date.now(),
          warnedBy: i.user.id
        };

        userWarnings.get(targetId).push(warnData);
        const totalWarns = userWarnings.get(targetId).length;

        // Check if user has 3 or more warnings for auto-mute
        let autoMuteMessage = "";
        if (totalWarns >= 3 && targetUser.voice.channel && !hasBypassRole(targetUser)) {
          try {
            await targetUser.voice.setMute(true);
            
            // Track auto-mute
            mutedByTracker.set(targetUser.id, {
              mutedBy: i.user.id,
              timestamp: Date.now(),
              autoMute: true
            });
            autoMuteMessage = "\n� **Auto-muted** due to 3+ warnings!";
          } catch (e) {
            console.log("Cannot auto-mute user:", e);
            autoMuteMessage = "\n⚠️ **Should be muted** but user not in voice or no permissions!";
          }
        } else if (totalWarns >= 3 && !targetUser.voice.channel) {
          autoMuteMessage = "\n⚠️ **Should be muted** but user not in voice channel!";
        } else if (totalWarns >= 3 && hasBypassRole(targetUser)) {
          autoMuteMessage = "\n🛡️ **Should be muted** but user has bypass role!";
        }

        // Embed bhejein
        const embed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("⚠️ User Warned")
          .addFields(
            { name: "👤 User", value: targetUser.toString(), inline: true },
            { name: "🔢 Total Warnings", value: `${totalWarns}`, inline: true },
            { name: "👮 Warned By", value: i.user.toString(), inline: true },
            { name: "📝 Reason", value: reason + autoMuteMessage, inline: false }
          )
          .setThumbnail(targetUser.user.displayAvatarURL())
          .setTimestamp();

        const warnMessage = await i.reply({ embeds: [embed] });

        // Delete warning message after 5 minutes
        setTimeout(() => {
          warnMessage.delete().catch(() => {});
        }, 5 * 60 * 1000);

        // Log channel mein bhi bhejein
        const logChannel = i.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
          logChannel.send({ embeds: [embed] });
        }

        // User ko DM bhejein (optional)
        try {
          const dmEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle(`⚠️ You have been warned in ${i.guild.name}`)
            .addFields(
              { name: "📝 Reason", value: reason, inline: false },
              { name: "🔢 Total Warnings", value: `${totalWarns}`, inline: false }
            )
            .setTimestamp();
          
          await targetUser.send({ embeds: [dmEmbed] });
        } catch (e) {
          console.log("Cannot DM user");
        }
      }
    }

    /* ================= BUTTONS HANDLING ================= */
    if (i.isButton()) {
        const customId = i.customId;

        // --- HANDLE .vcreq (Request to Join) ---
        if (customId.startsWith("vcreq_")) {
          try {
            const parts = customId.split("_");
            const type = parts[1];
            const requesterId = parts[2];
            const targetId = parts[3];
            
            // Only target can interact
            if (i.user.id !== targetId) {
              return i.reply({ 
                content: "❌ Sirf invited user hi button press kar sakta hai!", 
                ephemeral: true 
              }).catch(() => {});
            }

            // Defer the interaction first
            await i.deferUpdate().catch(() => {});

            const requester = await i.guild.members.fetch(requesterId).catch(() => null);

            // Deny Logic
            if (type === "deny") {
              const embed = new EmbedBuilder()
                .setColor("#ED4245")
                .setTitle("❌ Request Denied")
                .setDescription(`Request denied by <@${i.user.id}>.`);
              
              await i.message.edit({ 
                content: null, 
                embeds: [embed], 
                components: [] 
              }).catch((err) => {
                console.error("Error updating message on deny:", err);
              });
              return;
            }

            // Accept Logic
            if (type === "accept") {
              let embed;
              
              if (!requester?.voice.channel) {
                embed = new EmbedBuilder()
                  .setDescription("❌ Requester voice channel se chala gaya.")
                  .setColor("#ED4245");
              } else if (!i.member.voice.channel) {
                embed = new EmbedBuilder()
                  .setDescription("❌ Aap voice channel mein nahi ho.")
                  .setColor("#ED4245");
              } else {
                try {
                  await requester.voice.setChannel(i.member.voice.channel);
                  embed = new EmbedBuilder()
                    .setColor("#43B581")
                    .setTitle("✅ Request Approved")
                    .setDescription(`<@${requester.id}> has been moved to ${i.member.voice.channel} with permission from <@${i.user.id}>.`);
                } catch (moveErr) {
                  console.error("Move error:", moveErr);
                  embed = new EmbedBuilder()
                    .setDescription("❌ User ko move nahi kar paya. Bot ke paas permissions nahi hai.")
                    .setColor("#ED4245");
                }
              }

              await i.message.edit({ 
                content: null, 
                embeds: [embed], 
                components: [] 
              }).catch((err) => {
                console.error("Error updating message on accept:", err);
              });
              return;
            }
          } catch (err) {
            if (err.code !== 40060 && err.code !== 10062) console.error(err);
          }
        }

        // --- HANDLE .vcinv (Invite to VC) ---
        if (customId.startsWith("vcinv_")) {
            try {
              const parts = customId.split("_");
              const type = parts[1];
              const requesterId = parts[2];
              const targetId = parts[3];
              
              // Only invited user can interact
              if (i.user.id !== targetId) {
                return i.reply({ 
                  content: "❌ Sirf invited user hi button press kar sakta hai!", 
                  ephemeral: true 
                }).catch(() => {});
              }

              // Defer immediately for the correct user
              await i.deferUpdate().catch(() => {});

              const requester = await i.guild.members.fetch(requesterId).catch(() => null);
              const target = i.member;

              // Deny Logic
              if (type === "deny") {
                  const embed = new EmbedBuilder()
                    .setDescription(`❌ Invitation Declined by ${i.user}`)
                    .setColor("#ff0000");
                  
                  await i.message.edit({ 
                    content: null, 
                    embeds: [embed], 
                    components: [] 
                  }).catch((err) => {
                    console.error("Error editing message on vcinv deny:", err);
                  });
                  return;
              }

              // Join Logic
              if (type === "join") {
                  let embed;
                  
                  if (!requester || !requester.voice.channel) {
                      embed = new EmbedBuilder()
                        .setDescription("❌ Invite bhejne wala ab VC mein nahi hai.")
                        .setColor("#ff0000");
                  } else if (!target.voice.channel) {
                      embed = new EmbedBuilder()
                        .setDescription(`❌ Aapko pehle kisi bhi voice channel mein hona padega, tabhi main aapko **${requester.voice.channel.name}** mein move kar paunga!`)
                        .setColor("#ff0000");
                  } else {
                      try {
                        await target.voice.setChannel(requester.voice.channel);
                        embed = new EmbedBuilder()
                          .setDescription(`✅ ${target} joined **${requester.voice.channel.name}**!`)
                          .setColor("#00ff00");
                      } catch (moveErr) {
                        console.error("Move error:", moveErr);
                        embed = new EmbedBuilder()
                          .setDescription("❌ Aapko move nahi kar paya. Bot ke paas permissions nahi hai.")
                          .setColor("#ff0000");
                      }
                  }

                  await i.message.edit({ 
                    content: null, 
                    embeds: [embed], 
                    components: [] 
                  }).catch((err) => {
                    console.error("Error editing message on vcinv join:", err);
                  });
                  return;
              }
            } catch (err) {
              if (err.code !== 40060 && err.code !== 10062) console.error(err);
            }
        }

        // --- HANDLE .warn (Warn Button) ---
        if (customId.startsWith("warn_button_")) {
          try {
            const parts = customId.split("_");
            const targetId = parts[2];
            const requesterId = parts[3];
            
            // Only the person who used .warn can click
            if (i.user.id !== requesterId) {
              return i.reply({ 
                content: "❌ Sirf warn command use karne wala hi button press kar sakta hai!", 
                ephemeral: true 
              }).catch(() => {});
            }

            const targetUser = await i.guild.members.fetch(targetId).catch(() => null);
            
            if (!targetUser) {
              return i.reply({ content: "❌ User nahi mila", ephemeral: true });
            }

            // Modal (box) create karein
            const modal = new ModalBuilder()
              .setCustomId(`warn_modal_${targetId}`)
              .setTitle(`⚠️ Warn ${targetUser.user.username}`);

            const reasonInput = new TextInputBuilder()
              .setCustomId("warn_reason")
              .setLabel("Warn Reason")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("Warn ka reason yahan likho...")
              .setRequired(true)
              .setMaxLength(500);

            const row = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(row);

            await i.showModal(modal);

            // Delete the button message after modal is shown
            setTimeout(() => {
              i.message.delete().catch(() => {});
            }, 1000);

            return;
          } catch (err) {
            console.error("Warn button error:", err);
          }
        }
    }

    /* ================= SELECT MENU HANDLING ================= */
    if (i.isStringSelectMenu()) {
      if (i.customId === "help_category_select") {
        const selectedValue = i.values[0];
        
        let embed;
        
        switch (selectedValue) {
          case "home":
            embed = new EmbedBuilder()
              .setColor("#5865F2")
              .setTitle("Shanks Support Panel™")
              .setDescription("Choose a category from the dropdown below to see its commands.")
              .addFields(
                { name: "Categories:", value: "⚔️ | Moderation\n🔊 | Voice\n🎮 | Gaming VC\n🎫 | Ticket Support\n🔮 | Other", inline: false }
              )
              .setFooter({ text: "Shanks Support" })
              .setTimestamp();
            break;
            
          case "moderation":
            embed = new EmbedBuilder()
              .setColor("#ff0000")
              .setTitle("⚔️ Moderation Commands")
              .setDescription("**Admin/Mod Commands:**")
              .addFields(
                { name: "`.kick @user` or `.k @user`", value: "Kick a user from server", inline: false },
                { name: "`.ban @user` or `.b @user`", value: "Ban a user from server", inline: false },
                { name: "`.mute @user` or `.m @user`", value: "Mute user in voice channel", inline: false },
                { name: "`.unmute @user` or `.um @user`", value: "Unmute user in voice channel", inline: false },
                { name: "`.warn @user` or `.w @user`", value: "Warn a user with reason box", inline: false },
                { name: "`.scan @user` or `.s @user`", value: "Check user's warning history", inline: false },
                { name: "`.clear <number>` or `.c <number>`", value: "Delete messages (1-100)", inline: false },
                { name: "`.vvc @user1 @user2...`", value: "Move users to specific VC (Admin only)", inline: false }
              )
              .setFooter({ text: "⚠️ 3 warnings = Auto-mute | Only original muter can unmute" });
            break;
            
          case "voice":
            embed = new EmbedBuilder()
              .setColor("#00ff00")
              .setTitle("🔊 Voice Commands")
              .setDescription("**Voice Channel Commands:**")
              .addFields(
                { name: "`.vcreq @user` or `.vcr @user`", value: "Request to join someone's VC", inline: false },
                { name: "`.vcinv @user` or `.vci @user`", value: "Invite someone to your VC", inline: false },
                { name: "`.vchelp [message]` or `.vc [message]`", value: "Request voice help from staff", inline: false },
                { name: "`.move @user <channel_id>` or `.mv @user <channel_id>`", value: "Move user to specific VC (Mod+)", inline: false },
                { name: "`.moveall <channel_id>` or `.mvall <channel_id>`", value: "Move all users to one VC (Admin)", inline: false }
              )
              .setFooter({ text: "🎧 Voice commands for better communication" });
            break;
            
          case "gaming":
            embed = new EmbedBuilder()
              .setColor("#ff6600")
              .setTitle("🎮 Gaming VC Commands")
              .setDescription("**Gaming Voice Channel Features:**")
              .addFields(
                { name: "Auto VC Creation", value: "Join gaming channels to auto-create private VCs", inline: false },
                { name: "VC Management", value: "Manage your temporary gaming voice channels", inline: false },
                { name: "Game Integration", value: "Special features for popular games", inline: false }
              )
              .setFooter({ text: "🎮 Enhanced gaming experience" });
            break;
            
          case "ticket":
            embed = new EmbedBuilder()
              .setColor("#9932cc")
              .setTitle("🎫 Ticket Support")
              .setDescription("**Support Ticket System:**")
              .addFields(
                { name: "Create Ticket", value: "Use reaction or command to create support ticket", inline: false },
                { name: "Staff Response", value: "Staff will respond to your ticket privately", inline: false },
                { name: "Ticket Management", value: "Close, reopen, or transfer tickets", inline: false }
              )
              .setFooter({ text: "🎫 Get help from our support team" });
            break;
            
          case "other":
            embed = new EmbedBuilder()
              .setColor("#00ffff")
              .setTitle("🔮 Other Commands")
              .setDescription("**Utility & Fun Commands:**")
              .addFields(
                { name: "`.help` or `.h`", value: "Show this help menu", inline: false },
                { name: "Server Info", value: "Get server statistics and information", inline: false },
                { name: "User Info", value: "Check user profiles and stats", inline: false },
                { name: "Fun Commands", value: "Entertainment and interactive commands", inline: false }
              )
              .setFooter({ text: "🔮 Additional bot features" });
            break;
        }
        
        await i.update({ embeds: [embed] });
      }
    }

    /* ================= SLASH COMMANDS ================= */
    if (!i.isChatInputCommand()) return;

    const user = i.options.getMember("user");
    const ch = i.options.getChannel("channel");

    if (i.commandName === "kick") {
      if (!canUseCommand(i.member, [ADMIN_ROLE_ID])) return safeReply(i, "❌ Admin only", true);
      if (hasBypassRole(user)) return safeReply(i, "❌ Cannot kick - User has bypass role", true);
      await user.kick();
      return safeReply(i, "👢 User kicked");
    }

    if (i.commandName === "ban") {
      if (!canUseCommand(i.member, [ADMIN_ROLE_ID])) return safeReply(i, "❌ Admin only", true);
      if (hasBypassRole(user)) return safeReply(i, "❌ Cannot ban - User has bypass role", true);
      await user.ban();
      return safeReply(i, "🔨 User banned");
    }

    if (i.commandName === "mute") {
      if (!canUseCommand(i.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) return safeReply(i, "❌ Mod only", true);
      
      if (hasBypassRole(user)) return safeReply(i, "❌ Cannot mute - User has bypass role", true);

      const now = Date.now();
      let data = userMuteData.get(i.user.id) || { used: 0, resetAt: now + MUTE_RESET_TIME };

      if (now >= data.resetAt) {
        data.used = 0;
        data.resetAt = now + MUTE_RESET_TIME;
      }

      if (data.used >= MAX_MUTES_PER_USER) return safeReply(i, "❌ Mute chances khatam", true);

      await user.voice.setMute(true);
      data.used++;
      userMuteData.set(i.user.id, data);

      // Track who muted this user
      mutedByTracker.set(user.id, {
        mutedBy: i.user.id,
        timestamp: Date.now()
      });

      return safeReply(i, `🔇 Muted — **${MAX_MUTES_PER_USER - data.used} left**`);
    }

    if (i.commandName === "move") {
      if (!canUseCommand(i.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) return safeReply(i, "❌ Mod only", true);
      await user.voice.setChannel(ch);
      return safeReply(i, "🎧 User moved");
    }

    if (i.commandName === "moveall") {
      if (!canUseCommand(i.member, [ADMIN_ROLE_ID])) return safeReply(i, "❌ Admin only", true);
      await i.deferReply();
      let count = 0;
      for (const vc of i.guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildVoice)
        .values()) {
        for (const m of vc.members.values()) {
          await m.voice.setChannel(ch);
          count++;
        }
      }
      return safeReply(i, `🎧 ${count} users moved`);
    }

    if (i.commandName === "warn") {
      if (!canUseCommand(i.member, [MOD_ROLE_ID, ADMIN_ROLE_ID])) {
        return safeReply(i, "❌ Mod/Admin only", true);
      }

      const targetUser = i.options.getMember("user");
      
      if (!targetUser) {
        return safeReply(i, "❌ User nahi mila", true);
      }

      if (targetUser.id === i.user.id) {
        return safeReply(i, "❌ Apne aap ko warn nahi kar sakte!", true);
      }

      if (targetUser.user.bot) {
        return safeReply(i, "❌ Bots ko warn nahi kar sakte!", true);
      }

      if (hasBypassRole(targetUser)) {
        return safeReply(i, "❌ Cannot warn - User has bypass role", true);
      }

      // Modal (box) create karein
      const modal = new ModalBuilder()
        .setCustomId(`warn_modal_${targetUser.id}`)
        .setTitle(`⚠️ Warn ${targetUser.user.username}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId("warn_reason")
        .setLabel("Warn Reason")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Warn ka reason yahan likho...")
        .setRequired(true)
        .setMaxLength(500);

      const row = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(row);

      await i.showModal(modal);
      return;
    }

    if (i.commandName === "scan") {
      const targetUser = i.options.getUser("user");
      
      if (!targetUser) {
        return safeReply(i, "❌ User nahi mila", true);
      }

      const warnings = userWarnings.get(targetUser.id) || [];

      if (warnings.length === 0) {
        const embed = new EmbedBuilder()
          .setColor("#00ff00")
          .setTitle("✅ Clean Record")
          .setDescription(`**${targetUser.username}** ko koi warning nahi hai!`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();
        
        return i.reply({ embeds: [embed], ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle(`⚠️ Warning History - ${targetUser.username}`)
        .setDescription(`Total Warnings: **${warnings.length}**`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      // Last 10 warnings dikhayein
      const recentWarnings = warnings.slice(-10).reverse();
      
      recentWarnings.forEach((warn, index) => {
        const date = new Date(warn.date).toLocaleString('en-IN', { 
          timeZone: 'Asia/Kolkata',
          dateStyle: 'short',
          timeStyle: 'short'
        });
        
        embed.addFields({
          name: `Warning #${warn.id}`,
          value: `**Reason:** ${warn.reason}\n**By:** <@${warn.warnedBy}>\n**Date:** ${date}`,
          inline: false
        });
      });

      if (warnings.length > 10) {
        embed.setFooter({ text: `Showing last 10 of ${warnings.length} warnings` });
      }

      return i.reply({ embeds: [embed], ephemeral: true });
    }

    if (i.commandName === "clearwarns") {
      if (!canUseCommand(i.member, [ADMIN_ROLE_ID])) {
        return safeReply(i, "❌ Admin only", true);
      }

      const targetUser = i.options.getUser("user");
      
      if (!targetUser) {
        return safeReply(i, "❌ User nahi mila", true);
      }

      const warnings = userWarnings.get(targetUser.id) || [];
      const count = warnings.length;

      if (count === 0) {
        return safeReply(i, `❌ ${targetUser.username} ko koi warning nahi hai!`, true);
      }

      userWarnings.delete(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setDescription(`✅ **${count}** warning(s) cleared for ${targetUser}`)
        .setTimestamp();

      return i.reply({ embeds: [embed] });
    }

  } catch (e) {
    console.error(e);
    if (!i.replied && !i.deferred) {
        safeReply(i, "❌ Error", true);
    }
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);