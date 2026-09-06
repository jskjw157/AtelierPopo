import express from 'express';
import { requireAuth, requireCsrf } from './auth.js';
import { asyncRoute } from './http.js';
import { changePassword, passwordChangeLimiter } from './password.js';

const router = express.Router();

router.post(
  '/api/auth/change-password',
  requireAuth,
  requireCsrf,
  passwordChangeLimiter,
  asyncRoute(changePassword)
);

export default router;
