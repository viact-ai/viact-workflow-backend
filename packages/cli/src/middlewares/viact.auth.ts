import type { NextFunction, Request, Response } from 'express';
import config from '@/config';
import { ApplicationError } from 'n8n-workflow';
const axios = require('axios').default;

const umsServiceURL = config.get('viact.umsServiceURL');

export const viactAuth = async (req: Request, res: Response) => {
	const bearerToken = req.headers.authorization;
	const projectId = req.headers['x_project_id_x'];

	if (!bearerToken) {
		throw new ApplicationError('Auth get error, Invalid Token!');
	}

	const user = await userTokenIntrospect(bearerToken, projectId);

	return user;
};

const userTokenIntrospect = async (bearerToken: string, projectId: any) => {
	const tokenData = bearerToken.split(' ');
	if (tokenData[0] !== 'Bearer') {
		throw new ApplicationError('Auth get error, Invalid Bearer Token Format!');
	}

	let userInfo;
	try {
		const res = await axios.post(
			`${umsServiceURL}/api/v1/token/viact/introspect`,
			{
				token: tokenData[1],
				project_id: projectId, // pass project_id so that ums will check if user belong to project
			},
			{
				headers: {
					'Content-Type': 'application/json',
				},
			},
		);
		userInfo = res.data;
	} catch (error) {
		throw new ApplicationError('Unauthorized user, We met error when login with this user!');
	}

	if (!userInfo) {
		throw new ApplicationError('Unauthorized user, Invalid Token!');
	}
	if (userInfo.active) {
		return userInfo;
	} else {
		throw new ApplicationError('Unauthorized user, Token is expired!');
	}
};
