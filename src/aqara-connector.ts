import axios from 'axios';
import qs from 'qs';
import urllib from 'url';
import {Logging} from 'homebridge';

export class AqaraConnector {

    clientId: string;
    clientSecret: string;
    account: string;
    password: string;

    accessToken: string = '';
    refreshToken: string = '';
    expireTime: number = 0;

    airerDid: string = '';

    // motion calculation
    currentLevel?: number;
    targetLevel?: number;
    actionTime?: number;
    totalDuration?: number;
    speed: number = 100 / 8000;
    timeoutId?: NodeJS.Timeout;

    private readonly log: Logging;

    constructor(clientId: string, clientSecret: string, account: string, password: string, log: Logging) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.account = account;
        this.password = password;
        this.log = log;

        this.init();
    }

    init = async () => {
        this.log('airer initializing');
        const body = qs.stringify({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: 'https://www.xiongdianpku.com',
            account: this.account,
            password: this.password
        });
        this.log(`Oauth step 1 requesting with data: ${body}`);
        const response = await axios.post("https://aiot-oauth2.aqara.cn/authorize", body, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            maxRedirects: 0,
            validateStatus: status => status === 302
        });
        this.log(`Oauth step 1 response: ${JSON.stringify(response.headers)}`);
        const url = urllib.parse(response.headers.location, true);
        const code = url.query.code;

        await this.getTokenWithData({
            grant_type: 'authorization_code',
            code: code as string
        });

        await this.getAirerDid();
    }

    async getTokenWithData(data: {
        grant_type: 'authorization_code' | 'refresh_token',
        code?: string,
        refresh_token?: string
    }) {
        this.log('airer getting token');
        const tokenRes = await axios.post("https://aiot-oauth2.aqara.cn/access_token", qs.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: 'https://www.xiongdianpku.com',
            ...data
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(r => r.data);
        this.log(`Oauth step 2 response: ${JSON.stringify(tokenRes)}`);
        this.accessToken = tokenRes.access_token;
        this.refreshToken = tokenRes.refresh_token;
        this.expireTime = new Date().getTime() + parseInt(tokenRes.expires_in) * 1000
    }

    async refreshTokenIfNeeded() {
        if (this.expireTime <= new Date().getTime()) {
            await this.getTokenWithData({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken
            });
        }
    }

    async getAirerDid() {
        const models = await this.getAqara('/open/device/query');
        const airerModel = models.result.data.find((item: {model: string, did: string}) => item.model === 'lumi.airer.acn02');
        this.airerDid = airerModel?.did;
        if (this.airerDid) {
            this.log(`Found airer did: ${this.airerDid}`);
        } else {
            this.log(`No aqara airer device found`);
        }
    }

    async getAirerLevel() {
        const resource = await this.postAqara('/open/resource/query', {
            data: [{
                did: this.airerDid,
                attrs: ['level']
            }]
        });
        const level = resource.result.find((one: {attr: string}) => one.attr === 'level');
        return parseInt(level.value);
    }

    async getEstimatedCurrentLevel() {
        if (this.actionTime) {
            return Math.min(Math.max(this.currentLevel! + (this.targetLevel! - this.currentLevel!) * (new Date().getTime() - this.actionTime) / this.totalDuration!, 0), 100);
        } else {
            return await this.getAirerLevel();
        }
    }

    async getStatePosition() {
        const resource = await this.postAqara('/open/resource/query', {
            data: [{
                did: this.airerDid,
                attrs: ['airer_control']
            }]
        });
        const airer_control = resource.result.find((one: {attr: string}) => one.attr === 'airer_control');
        switch (parseInt(airer_control.value)) {
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
        const resource = await this.postAqara('/open/resource/query', {
            data: [{
                did: this.airerDid,
                attrs: ['light_control']
            }]
        });
        const level = resource.result.find((one: {attr: string}) => one.attr === 'light_control');
        return parseInt(level.value);
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
        const headers = this.commonHeaders();
        this.log(`Get Aqara Request to ${path}, headers: ${JSON.stringify(headers)}`);
        const res = await axios.get( `https://aiot-open-3rd.aqara.cn/3rd/v1.0${path}`, {
            headers
        }).then(res => res.data);
        this.log(`Get Aqara Response: ${JSON.stringify(res)}`);
        return res;
    }

    async postAqara(path: string, data: any) {
        while (!this.airerDid) {
            // waiting for airer initializing
            await new Promise(r => setTimeout(r, 1000));
        }
        await this.refreshTokenIfNeeded();
        const headers = this.commonHeaders();
        this.log(`Post Aqara Request to ${path} with data: ${JSON.stringify(data)}, headers: ${JSON.stringify(headers)}`);
        const res = await axios.post( `https://aiot-open-3rd.aqara.cn/3rd/v1.0${path}`, data, {
            headers
        }).then(res => res.data);
        this.log(`Post Aqara Response: ${JSON.stringify(res)}`);
        return res;
    }
}