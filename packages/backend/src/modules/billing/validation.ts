import Joi from 'joi';

/** POST /api/billing/checkout. `interval` is optional (monthly by default) but, when sent, must be exactly 'month' or 'year'. */
export const checkoutSchema = Joi.object({
  plan: Joi.string()
    .valid('pro', 'team')
    .required()
    .messages({ 'any.only': "plan must be 'pro' or 'team'", 'any.required': "plan must be 'pro' or 'team'" }),
  interval: Joi.string()
    .valid('month', 'year')
    .default('month')
    .messages({ 'any.only': "interval must be 'month' or 'year'" }),
});
