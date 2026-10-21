/**
 * Unified Command Context Helper
 * Cho phép các command chạy mượt mà trên cả Discord Slash Commands (/) và Prefix Commands (.)
 */

class CommandContext {
  constructor(source, rawArgs = []) {
    this.source = source;
    this.rawArgs = rawArgs || [];
    this.isInteraction = Boolean(source && source.isChatInputCommand && source.isChatInputCommand());
    this.interaction = this.isInteraction ? source : null;
    this.message = this.isInteraction ? null : source;

    this.client = source.client;
    this.guild = source.guild;
    this.channel = source.channel;
    this.member = source.member;
    this.user = this.isInteraction ? source.user : source.author;
    this.author = this.user;

    this.deferred = Boolean(this.interaction?.deferred);
    this.replied = Boolean(this.interaction?.replied);
    this._sentMessage = null;

    this.options = this._createOptionsAdapter();
  }

  _createOptionsAdapter() {
    if (this.isInteraction) {
      return this.interaction.options;
    }

    // Adapter cho Prefix Message args
    const args = this.rawArgs;
    return {
      getString: (name) => {
        if (!args || args.length === 0) return null;
        return args.join(' ');
      },
      getInteger: (name) => {
        if (!args || args.length === 0) return null;
        const num = parseInt(args[0], 10);
        return isNaN(num) ? null : num;
      },
      getBoolean: (name) => {
        if (!args || args.length === 0) return null;
        const lower = args[0].toLowerCase();
        if (['true', 'yes', 'on', '1', 'bat'].includes(lower)) return true;
        if (['false', 'no', 'off', '0', 'tat'].includes(lower)) return false;
        return null;
      },
      getChannel: (name) => {
        if (!this.message) return null;
        const mention = this.message.mentions.channels.first();
        if (mention) return mention;
        if (args[0]) {
          const id = args[0].replace(/[<#>]/g, '');
          return this.guild.channels.cache.get(id) || null;
        }
        return null;
      },
      getRole: (name) => {
        if (!this.message) return null;
        const mention = this.message.mentions.roles.first();
        if (mention) return mention;
        if (args[0]) {
          const id = args[0].replace(/[<@&>]/g, '');
          return this.guild.roles.cache.get(id) || null;
        }
        return null;
      },
      getSubcommand: (required = false) => {
        if (!args || args.length === 0) {
          if (required) throw new Error('Thiếu subcommand');
          return null;
        }
        return args[0].toLowerCase();
      }
    };
  }

  async deferReply(options = {}) {
    if (this.isInteraction) {
      if (!this.deferred && !this.replied) {
        await this.interaction.deferReply(options);
        this.deferred = true;
      }
    }
  }

  async reply(payload) {
    if (this.isInteraction) {
      if (this.deferred || this.replied) {
        return this.interaction.editReply(payload);
      }
      this.replied = true;
      return this.interaction.reply(payload);
    } else {
      const msg = await this.message.reply(payload);
      this._sentMessage = msg;
      this.replied = true;
      return msg;
    }
  }

  async editReply(payload) {
    if (this.isInteraction) {
      return this.interaction.editReply(payload);
    } else {
      if (this._sentMessage && typeof this._sentMessage.edit === 'function') {
        return this._sentMessage.edit(payload);
      }
      const msg = await this.message.reply(payload);
      this._sentMessage = msg;
      return msg;
    }
  }

  async followUp(payload) {
    if (this.isInteraction) {
      return this.interaction.followUp(payload);
    } else {
      return this.channel.send(payload);
    }
  }

  async sendTemp(payload, delayMs = 7000) {
    if (this.isInteraction) {
      // Với Interaction, gửi ephemeral (chỉ user thấy) nếu chưa defer
      if (!this.deferred && !this.replied) {
        return this.interaction.reply({ ...this._normalizePayload(payload), flags: 64 });
      } else {
        return this.interaction.editReply(payload);
      }
    } else {
      try {
        const msg = await this.message.reply(payload);
        setTimeout(() => {
          msg.delete().catch(() => {});
          if (this.message?.deletable) this.message.delete().catch(() => {});
        }, delayMs);
        return msg;
      } catch (e) {
        return null;
      }
    }
  }

  _normalizePayload(payload) {
    if (typeof payload === 'string') {
      return { content: payload };
    }
    return payload;
  }
}

function createContext(source, rawArgs = []) {
  return new CommandContext(source, rawArgs);
}

module.exports = {
  CommandContext,
  createContext
};
