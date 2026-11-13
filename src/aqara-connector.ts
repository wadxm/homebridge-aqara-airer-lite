import axios from 'axios';
import {Logging} from 'homebridge';

const DEFAULT_REDIRECT_URI = 'https://www.xiongdianpku.com';
const AIRER_MODEL = 'lumi.airer.acn02';

export class AqaraConnector {

    clientId: string;
    clientSecret: string;
    account: string;
    password: string;
    redirectUri: string;

    accessToken: string = '';
    refreshToken: string = '';
    expireTime: number = 0;

    airerDid: string = '';

    private initPromise?: Promise<void>;

    // motion calculation
    currentLevel?: number;
    targetLevel?: number;
    actionTime?: number;
    totalDuration?: number;
    speed: number = 100 / 8000;
    timeoutId?: NodeJS.Timeout;

    private readonly log: Logging;

    constructor(clientId: string, clientSecret: string, account: string, password: string, log: Logging, redirectUri?: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.account = account;
        this.password = password;
        this.redirectUri = redirectUri || DEFAULT_REDIRECT_URI;
        this.log = log;

        this.ensureReady().catch(() => undefined);
    }

    ensureReady(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.init().catch(e => {
                this.initPromise = undefined;
                this.log.error(`Aqara airer initialization failed: ${e}`);
                throw e;
            });
        }
        return this.initPromise;
    }

    private async init() {
        this.log.info('airer initializing');
        await this.authorize();
        await this.getAirerDid();
    }

    private async authorize() {
        const body = new URLSearchParams({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: this.redirectUri,
            account: this.account,
            password: this.password
        }).toString();
        this.log.debug('OAuth step 1: requesting authorization code');
        const response = await axios.post('https://aiot-oauth2.aqara.cn/authorize', body, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            maxRedirects: 0,
            validateStatus: status => status === 302
        });
        const location = response.headers.location;
        const code = location ? new URL(location).searchParams.get('code') : null;
        if (!code) {
            throw new Error('OAuth authorization did not return a code, please check account and password');
        }

        await this.getTokenWithData({
            grant_type: 'authorization_code',
            code
        });
    }

    async getTokenWithData(data: {
        grant_type: 'authorization_code' | 'refresh_token',
        code?: string,
        refresh_token?: string
    }) {
        this.log.debug(`OAuth step 2: requesting token (${data.grant_type})`);
        const params: Record<string, string> = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            grant_type: data.grant_type
        };
        if (data.code) {
            params.code = data.code;
        }
        if (data.refresh_token) {
            params.refresh_token = data.refresh_token;
        }
        const tokenRes = await axios.post('https://aiot-oauth2.aqara.cn/access_token', new URLSearchParams(params).toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(r => r.data);
        if (!tokenRes || !tokenRes.access_token) {
            throw new Error(`Failed to get access token: ${tokenRes?.message ?? tokenRes?.error ?? 'unknown error'}`);
        }
        this.log.debug(`OAuth step 2: token received, expires in ${tokenRes.expires_in}s`);
        this.accessToken = tokenRes.access_token;
        this.refreshToken = tokenRes.refresh_token;
        this.expireTime = new Date().getTime() + parseInt(tokenRes.expires_in) * 1000;
    }

    async refreshTokenIfNeeded() {
        if (this.expireTime > new Date().getTime()) {
            return;
        }
        try {
            await this.getTokenWithData({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken
            });
        } catch (e) {
            this.log.warn(`Refreshing token failed, re-authorizing: ${e}`);
            await this.authorize();
        }
    }

    async getAirerDid() {
        const models = await this.getAqara('/open/device/query');
        const devices: { model: string, did: string }[] = models?.result?.data ?? [];
        const airerModel = devices.find(item => item.model === AIRER_MODEL);
        if (!airerModel?.did) {
            throw new Error(`No Aqara airer device (${AIRER_MODEL}) found in this account`);
        }
        this.airerDid = airerModel.did;
        this.log.info(`Found airer did: ${this.airerDid}`);
    }

    private async queryAttr(attr: string) {
        const resource = await this.postAqara('/open/resource/query', {
            data: [{
                did: this.airerDid,
                attrs: [attr]
            }]
        });
        const found = (resource?.result ?? []).find((one: { attr: string }) => one.attr === attr);
        if (!found) {
            throw new Error(`Attribute ${attr} not returned by Aqara: ${resource?.message ?? 'unknown error'}`);
        }
        return parseInt(found.value);
    }

    async getAirerLevel() {
        return this.queryAttr('level');
    }

    async getEstimatedCurrentLevel() {
        if (this.actionTime) {
            return Math.min(Math.max(this.currentLevel! + (this.targetLevel! - this.currentLevel!) * (new Date().getTime() - this.actionTime) / this.totalDuration!, 0), 100);
        } else {
            return await this.getAirerLevel();
        }
    }

    async getStatePosition() {
        switch (await this.queryAttr('airer_control')) {
            case 0:
                return 2;
            case 1:
                return 1;
            case 2:
                return 0;
        }
        return 2;
    }

    async setAirerLevel(level: number, onStopped: () => void) {
        this.currentLevel = await this.getAirerLevel();
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
        const action = await this.postAqara('/open/resource/update', {
            did: this.airerDid,
            attrs: {
                level: level
            }
        });
        if (action.code === 0) {
            this.targetLevel = level;
            this.actionTime = new Date().getTime();
            this.totalDuration = Math.abs(this.targetLevel - this.currentLevel) / this.speed;
            this.timeoutId = setTimeout(() => {
                this.currentLevel = this.targetLevel = this.actionTime = this.totalDuration = this.timeoutId = undefined;
                onStopped();
            }, this.totalDuration);
            return true;
        } else {
            return false;
        }
    }

    async getAirerLightStatus() {
        return this.queryAttr('light_control');
    }

    async setAirerLightStatus(isOn: boolean) {
        const action = await this.postAqara('/open/resource/update', {
            did: this.airerDid,
            attrs: {
                light_control: isOn ? 1 : 0
            }
        });
        return action.code === 0;
    }

    commonHeaders() {
        return {
            Appid: this.clientId,
            Accesstoken: this.accessToken,
            Time: new Date().getTime()
        };
    }

    async getAqara(path: string) {
        await this.refreshTokenIfNeeded();
        this.log.debug(`Get Aqara request to ${path}`);
        const res = await axios.get(`https://aiot-open-3rd.aqara.cn/3rd/v1.0${path}`, {
            headers: this.commonHeaders()
        }).then(res => res.data);
        this.log.debug(`Get Aqara response: ${JSON.stringify(res)}`);
        return res;
    }

    async postAqara(path: string, data: any) {
        await this.ensureReady();
        await this.refreshTokenIfNeeded();
        this.log.debug(`Post Aqara request to ${path} with data: ${JSON.stringify(data)}`);
        const res = await axios.post(`https://aiot-open-3rd.aqara.cn/3rd/v1.0${path}`, data, {
            headers: this.commonHeaders()
        }).then(res => res.data);
        this.log.debug(`Post Aqara response: ${JSON.stringify(res)}`);
        return res;
    }
}
