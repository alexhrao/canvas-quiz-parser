import parse from "csv-parse/lib/sync";
import {
    Question,
    Essay,
    FITB,
    Student,
    QuizResponse,
    CanvasStudent,
    QuestionType,
    CanvasConfig,
} from "../types";
import { getQuestion } from "../canvas";

const dispatchResponse = (ans: string, quest: Question): QuizResponse => {
    if (ans !== "") {
        if (quest.type === QuestionType.ESSAY) {
            return {
                type: QuestionType.ESSAY,
                question: quest as Essay,
                response: ans,
            };
        } else if (quest.type === QuestionType.FITB) {
            // Split blanks. ONLY invalid character is \n. Replace \, with it, then split, then re-engage:
            const sanitized = ans.replace(/\\,/gi, "\n");
            const answers = sanitized.split(",").map(a => a.replace(/\n/gi, ","));
            return {
                type: QuestionType.FITB,
                question: quest as FITB,
                response: answers
            };
        } else {
            return {
                type: QuestionType.OTHER,
                question: quest,
                response: ans,
            };
        }
    } else if (quest.type === QuestionType.FITB) {
        return {
            type: QuestionType.FITB,
            question: quest as FITB,
            response: undefined,
        };
    } else if (quest.type === QuestionType.ESSAY) {
        return {
            type: QuestionType.ESSAY,
            question: quest as Essay,
            response: undefined,
        };
    } else {
        return {
            type: QuestionType.OTHER,
            question: quest,
            response: undefined,
        };
    }
};

/**
 * Parse quiz responses and generate their JSON equivalent.
 * @param data The raw CSV data from the CSV report; @see requestCSV
 * @param roster The students to interleave into the responses; students who did not submit anything will also be included
 * @param config The Canvas configuration to use when fetching questions; @see getQuestion
 * @returns A Promise that resolves to an array of complete Student responses.
 */
const parseResponses = async (data: string, roster: CanvasStudent[], config: CanvasConfig): Promise<Student[]> => {
    const output = parse(data, {
        bom: true,
    }) as string[][];
    //console.log(output);
    const header = output[0];
    const idCol = header.lastIndexOf("id");
    const questionStartCol = Math.max(header.lastIndexOf("submitted"), header.lastIndexOf("attempt")) + 1;
    const questionStopCol = header.lastIndexOf("n correct");
    // convert header questions to literally just be ID
    const questions: Question[] = [];
    for (let j = questionStartCol; j < questionStopCol; j += 2) {
        const qId = header[j].split(":")[0];
        questions.push(await getQuestion(config, qId));
    }

    const submissions: Student[] = output.slice(1).flatMap(record => {
        const login = roster.find(s => s.id.toString() === record[idCol]);
        if (login === undefined) {
            return [];
        }
        const responses: QuizResponse[] = questions.map((quest, q) => {
            const ind = questionStartCol + (q * 2);
            return dispatchResponse(record[ind], quest);
        }).sort((qr1, qr2) => {
            return (qr1.question.position - qr2.question.position) || (parseInt(qr1.question.id) - parseInt(qr2.question.id));
        });
        return [{
            id: record[idCol],
            login: login.login_id,
            email: login.email,
            name: login.name,
            sisid: login.sis_user_id,
            responses
        }];
    });
    questions.sort((q1, q2) => {
        return (q1.position - q2.position) || (parseInt(q1.id) - parseInt(q2.id));
    });
    const template: Student = {
        id: "-1",
        login: "_______________",
        email: "null",
        name: "_______________",
        sisid: "_______________",
        responses: questions.map(quest => dispatchResponse("", quest)),
    };
    return [ template, ...roster.map(stud => {
        const sub = submissions.find(other => other.id === stud.id.toString());
        if (sub !== undefined) {
            return sub;
        } else {
            // questions will be in the right order!
            const resps: QuizResponse[] = questions.map(quest => dispatchResponse("", quest));
            return {
                id: stud.id.toString(),
                login: stud.login_id,
                email: stud.email,
                name: stud.name,
                sisid: stud.sis_user_id,
                responses: resps,
            };
        }
    })];
};

export default parseResponses;