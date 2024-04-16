const { Op, fn, col } = require('sequelize');

const getData = async (model, qs) => {
    try {
        return await model.findAll(qs);
    } catch (error) {
        throw new Error(error);
    }
}

const updateData = async (model, identifier, data, transaction = null) => {
    try {
        return await model.update(data, { where: identifier, transaction });
    } catch (error) {
        throw new Error(error);
    }
}

const mathematicalOperations = async (model, field, amount, identifier, mode, transaction = null) => {
    try {
        if (mode === 'inc') {
            return model.increment(field.toString(), { by: amount, where: { id: identifier }, transaction });
        } else {
            return model.decrement(field.toString(), { by: amount, where: { id: identifier }, transaction });
        }
    } catch (error) {
        throw new Error(error);
    }
}

const createGeneralQueryForAdmin = async (Job, Contract, Profile, start, end, alias, groupByKey, limit = 1) => {
    const qs = {
        raw: true,
        where: {
            paymentDate: { [Op.between]: [start, end] },
            paid: 1
        },
        include: [{
            model: Contract,
            include: [
                {
                    model: Profile,
                    as: alias
                }
            ]
        }],
        attributes: [[fn('SUM', col('price')), 'total']],
        group: [groupByKey],
        order: [[col('total'), 'DESC']],
        limit: limit
    }
    return await getData(Job, qs);
}

module.exports = {
    getData,
    updateData,
    mathematicalOperations,
    createGeneralQueryForAdmin
}