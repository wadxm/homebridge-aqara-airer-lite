import axios from 'axios';
import qs from 'qs';
import urllib from 'url';
import { Characteristic } from 'homebridge';

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
    speed: number = 100 / 8;
    timeoutId?: NodeJS.Timeout;

    constructor(clientId: string, clientSecret: string, account: string, password: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.account = account;
        this.password = password;

        this.init();
    }

    init = async () => {
        const res = await axios.post("https://aiot-oauth2.aqara.cn/authorize", qs.stringify({
            client_id: this.clientId,
            response_type: 'code',
            redirect_uri: 'https://www.xiongdianpku.com',
            account: this.account,
            password: this.password
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(r => r.data);
        if (res.code !== 0) {
            throw new Error(res.code);
        }
        const url = urllib.parse(res.result?.location, true);
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
        if (tokenRes.code !== 0) {
            throw new Error(tokenRes.code);
        }
        this.accessToken = tokenRes.result.access_token;
        this.refreshToken = tokenRes.result.refresh_token;
        this.expireTime = new Date().getTime() + parseInt(tokenRes.result.expires_in) * 1000
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
        const models = await this.postAqara('/open/device/query', {});
        const airerModel = models.result.data.find((item: {model: string, did: string}) => item.model === 'lumi.airer.acn02');
        this.airerDid = airerModel?.did;
    }

    async getAirerLevel() {
        const resource = await this.postAqara('/open/resource/query', {
            did: this.airerDid,
            attrs: ['level']
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
            did: this.airerDid,
            attrs: ['airer_control']
        });
        const airer_control = resource.result.find((one: {attr: string}) => one.attr === 'airer_control');
        switch (parseInt(airer_control.value)) {
            case 0:
                return Characteristic.PositionState.STOPPED;
            case 1:
                return Characteristic.PositionState.INCREASING;
            case 2:
                return Characteristic.PositionState.DECREASING;
        }
        return Characteristic.PositionState.STOPPED;
    }

    async setAirerLevel(level: number) {
        const action = await this.postAqara('/open/resource/update', {
            did: this.airerDid,
            attrs: {
                level: level
            }
        });
        if (action.code === 0) {
            this.currentLevel = await this.getAirerLevel();
            this.targetLevel = level;
            this.actionTime = new Date().getTime();
            this.totalDuration = Math.abs(this.targetLevel - this.currentLevel) / this.speed;
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
            }
            this.timeoutId = setTimeout(() => {
                this.currentLevel = this.targetLevel = this.actionTime = this.totalDuration = undefined;
            }, this.totalDuration);
            return true;
        } else {
            return false;
        }
    }

    async getAirerLightStatus() {
        const resource = await this.postAqara('/open/resource/query', {
            did: this.airerDid,
            attrs: ['light_control']
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

    async postAqara(path: string, data: any) {
        return await axios.post( `https://aiot-oauth2.aqara.cn${path}`, data, {
            headers: {
                Appid: this.clientId,
                Accesstoken: this.accessToken,
                Time: new Date().getTime()
            }
        }).then(res => res.data);
    }
}