import fetch from "node-fetch";
/**
 * getCsv will return a Promise that resolves to the raw CSV textual data.
 * This uses the Canvas LMS API - specifically the Quiz Reports section. For
 * more information, look at the Canvas API Documentation.
 * @param {string} site The base canvas URL (i.e., institute.instructure.com)
 * @param {string} course The Course ID
 * @param {string} quiz The Quiz ID
 * @param {string} token The Canvas API Token to use
 */
export default async function getCsv(site, course, quiz, token) {
    const reportApi = "https://" + site + "/api/v1/courses/" + course + "/quizzes/" + quiz
        + "/reports?quiz_report[report_type]=student_analysis&"
        + "include[]=progress&include[]=file";
    
    return fetch(reportApi, {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + token
        }
    })
        .then(resp => resp.json())
        .then(async resp => {
        // check progress every 5 seconds until workflow state is complete!
            let isDone = false;
            do {
            // fetch!
                await fetch(resp.progress_url, {
                    headers: {
                        "Authorization": "Bearer " + token
                    }})
                    .then(resp => resp.json())
                    .then(resp => {
                        isDone = resp.completion === 100;
                    });
            } while (!isDone);
        // It's complete! Make GET request for file itself
        })
        .then(() => {
        // get the file
            return fetch(reportApi, {
                headers: {
                    "Authorization": "Bearer " + token
                }});
        })
        .then(resp => resp.json())
        .then(async resp => {
        // get the file
        // if we have two items, get the first one
            const fileUrl = resp.length > 1 ? resp[0].file.url : resp.file.url;
            return fetch(fileUrl, {
                headers: {
                    "Authorization": "Bearer " + token
                }})
                .then(resp => resp.text());
        });
}
