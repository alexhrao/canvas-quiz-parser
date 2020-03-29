import { QuizResponse } from "../types";
import formatBlank from "./formatBlank";

/**
 * Print a generic quiz response
 * @param qr The generic Quiz Response
 * @returns HTML suitable to be printed in the PDF
 */
const formatOther = (qr: QuizResponse): string => {
    const { question, response } = qr;
    if (qr.response === undefined) {
        return formatBlank(qr);
    }
    const { name, prompt } = question;
    return `<div class="question other"><h2>${name}</h2>${prompt}<p>${response}</p></div>`;
};

export default formatOther;